// @ts-check
/**
 * liveness-api.mjs — zero-token liveness check for ATS-hosted job postings.
 *
 * Many postings live on ATS platforms (Greenhouse, Lever, Ashby, Workday, ...) that
 * expose a public JSON endpoint. We can confirm whether a posting is still live by
 * hitting that endpoint directly — no browser, no LLM tokens — and only fall back to
 * the Playwright check (liveness-browser.mjs) for non-ATS pages or when the API is
 * inconclusive. This is the cheap first rung of the liveness ladder.
 *
 * CONSERVATIVE BY DESIGN: a false "expired" is worse than the status quo (the user
 * misses a real job). So we return `expired` only on a definitive signal — a
 * 404/410, or a closed marker the provider's `interpret` step recognises — and for
 * anything ambiguous (unknown ATS, redirect, 429/5xx, network/timeout) we return
 * `null` (→ caller falls back to Playwright).
 *
 * Three endpoint shapes:
 *   - Per-job (Greenhouse, Lever, Workday): the URL maps to a single-job endpoint,
 *     so a 200 is itself proof the posting is live. Workday also reads its 403
 *     body, whose error code tells a withdrawn posting apart from a blocked
 *     request.
 *   - Org-level (Ashby): the URL maps to the org's whole job board. A 200 only
 *     proves the board exists, so the provider's `interpret` step parses the board
 *     and confirms THIS posting is still listed before returning active/expired.
 *     (Ashby pages are JS-rendered, so the browser/static rung sees only nav/footer
 *     and false-reports live postings as expired — this API rung is authoritative.)
 *   - Per-job HTML (LinkedIn): the guest endpoint returns the rendered posting as
 *     HTML and answers 200 for closed postings too, so `interpret` reads two
 *     independent signals out of the body and only concludes when they agree.
 *     Zoho Recruit and UltiPro are the same shape: their posting pages embed
 *     the record and answer 200 for a removed posting too, so `interpret` reads
 *     the body.
 *
 * SSRF-safe by construction: the request URL is built from a FIXED, hard-coded API
 * host plus path segments extracted from the posting URL with a strict charset
 * (no slashes / traversal), and server-side redirects are refused.
 */

import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { parseWwrFeed } from './providers/weworkremotely.mjs';
import { ZOHO_HOST_RE, isZohoRecordClosed, parseZohoDetailPage } from './providers/zoho-recruit.mjs';
import { HOST_RE as ULTIPRO_HOST_RE, extractCandidateOpportunityDetail } from './providers/ultipro.mjs';
import { VEJ_KEY_MONITOR } from './providers/vdab.mjs';
import { atsVendorOf } from './ats-vendor.mjs';
import { linkedInJobId, linkedInGuestUrl } from './lib/linkedin-url.mjs';

const TIMEOUT_MS = 8_000;
// Strict path-segment charset. Anything with a slash, dot-dot, or other char is
// rejected before it can reach the fixed-host API URL template. The one escape
// allowed is %20, because some Ashby org slugs contain a space (#5018). A space
// cannot end a segment or form a traversal; %2F and every other escape still fail.
const SAFE_SEGMENT = /^(?:[A-Za-z0-9._-]|%20)+$/;

// Most providers extract single path segments (SAFE_SEGMENT covers those directly).
// Workday's job path is genuinely multi-segment (a location slug + a title slug,
// e.g. "Toronto-ON-CAN/Agentic-AI-Engineer_R260010125"), so a `parts` value may
// itself contain slashes. This still validates every individual segment against
// the same strict charset (and rejects ".." in any of them) — it only relaxes
// "no slash at all" to "no *unsafe* content between slashes", so the traversal/
// injection guarantee is unchanged.
function isSafeValue(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  // SAFE_SEGMENT's charset includes "." (some real segments use dots), so ".."
  // alone passes that regex — same as the single-segment guard in
  // resolveAtsApi below, the explicit `!includes('..')` check per segment is
  // load-bearing, not redundant with the regex test.
  return v.split('/').every((seg) => seg.length > 0 && SAFE_SEGMENT.test(seg) && !seg.includes('..'));
}

// Each ATS: detect its posting URL, then map to a public JSON API URL.
// `match` returns the extracted path params (or null); `api` builds the FIXED-host URL.
// Optional per-provider fields:
//   `timeoutMs`  — override the default fetch timeout (slow/rate-limited APIs).
//   `throttleMs` — minimum interval between our requests to this provider.
//   `accept`     — override the Accept header (providers that answer in HTML).
//   `method`     — HTTP method of the API request; defaults to GET.
//   `body`       — builds the request body from the extracted params, for an
//                  endpoint that only answers a POST (see the `meituan` entry).
//   `interpret`  — read the response body to decide liveness (org-level APIs
//                  where a 200 alone doesn't prove THIS posting is live, and
//                  per-job APIs that answer 200 for a closed posting).
//   `interpretStatuses` — the statuses whose body `interpret` reads; defaults
//                  to [200]. A provider that answers a closed posting with an
//                  error status carrying a recognisable body lists that status
//                  here instead (see the `workday` entry); a 200 it leaves out
//                  takes the default per-job reading, proof the posting is live.
//                  A 404 or 410 listed here is read the same way, in place of
//                  the 404 rule below (see the `nofluffjobs` entry).
//   `api404Authoritative` — defaults to true (a 404/410 means gone). Set to
//                  false when the provider's public API can 404 a posting that
//                  is still genuinely live elsewhere (see the `lever` entry).
const ATS_PROVIDERS = [
  {
    id: 'greenhouse-embedded',
    // Company careers pages can expose only gh_jid, with no Greenhouse board.
    // The embed redirect supplies the board; a second per-job API request is
    // still required because even closed jobs can have an embed redirect.
    // Scanners often record these pages as plain http (http://block.xyz/careers/
    // jobs/N?gh_jid=N); only the gh_jid matters and both API hosts are fixed, so
    // the page's scheme is accepted. Without this the posting fell to the browser,
    // which timed out or saw the id dropped by a redirect and answered uncertain.
    acceptsHttp: true,
    match(u) {
      if (/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;
      const id = u.searchParams.get('gh_jid');
      return id && /^\d+$/.test(id) ? { id } : null;
    },
    api: ({ id }) => `https://boards.greenhouse.io/embed/job_app?token=${id}`,
    async followEmbed(res, { id }) {
      if (res.status !== 301 && res.status !== 302) return null;
      let target;
      try { target = new URL(res.headers.get('location'), 'https://boards.greenhouse.io'); }
      catch { return null; }
      if (target.protocol !== 'https:' || !/(^|\.)greenhouse\.io$/.test(target.hostname)) return null;
      const board = target.searchParams.get('for');
      // The board is one URL path segment. isSafeValue also accepts Workday's
      // multi-segment paths, so reject a decoded slash here explicitly.
      if (!isSafeValue(board) || board.includes('/') || target.searchParams.get('token') !== id) return null;
      return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`;
    },
  },
  {
    id: 'greenhouse',
    // boards.greenhouse.io/{board}/jobs/{id} · job-boards[.eu].greenhouse.io/{board}/jobs/{id}
    match(u) {
      if (atsVendorOf(u.href) !== 'greenhouse') return null;
      const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/);
      return m ? { board: m[1], id: m[2] } : null;
    },
    api: ({ board, id }) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`,
  },
  {
    id: 'lever',
    // jobs.(eu.)?lever.co/{slug}/{id}
    match(u) {
      if (atsVendorOf(u.href) !== 'lever') return null;
      const host = u.hostname.match(/^jobs\.((?:eu\.)?lever\.co)$/);
      if (!host) return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/?#]+)\/?$/);
      return m ? { apiHost: `api.${host[1]}`, slug: m[1], id: m[2] } : null;
    },
    api: ({ apiHost, slug, id }) => `https://${apiHost}/v0/postings/${slug}/${id}`,
    // Lever's Confidential/Internal Postings feature explicitly excludes some
    // live postings from the public v0/postings API while the direct
    // jobs.lever.co page keeps serving them normally. Real-world repro
    // (2026-08-09): api.lever.co 404s two postings whose jobs.lever.co pages
    // return 200 with the real job title and a working Apply control. A 404
    // here is NOT proof of removal — fall through to Playwright instead.
    api404Authoritative: false,
  },
  {
    id: 'workable',
    // apply.workable.com/{account}/j/{shortcode}
    match(u) {
      if (u.hostname !== 'apply.workable.com') return null;
      const m = u.pathname.match(/^\/([^/]+)\/j\/([A-Za-z0-9_-]+)\/?$/);
      return m ? { account: m[1], shortcode: m[2] } : null;
    },
    api: ({ account, shortcode }) => `https://apply.workable.com/api/v2/accounts/${account}/jobs/${shortcode}`,
    // Workable's posting pages render client-side, so the browser rung reads a
    // not-yet-painted live posting as nav/footer only (insufficient_content),
    // which used to read as expired, the costly direction: scan --verify wrote
    // that to scan-history as skipped. The v2 JSON endpoint is per-job and needs no
    // browser. Measured live (#5000): 200 with state "published" is the live
    // shape and 404 ("Job not found") is the removed shape, so a 404 is
    // authoritative here and any other readable state stays uncertain.
    async interpret(res) {
      let posting;
      try { posting = await res.json(); } catch { return null; }
      return classifyWorkablePosting(posting);
    },
  },
  {
    id: 'workable-short',
    // apply.workable.com/j/{shortcode} is the share link, and it carries no
    // account. Following its own redirect yields /{account}/j/{shortcode},
    // which names the account the v2 endpoint needs (#5000).
    match(u) {
      if (u.hostname !== 'apply.workable.com') return null;
      const m = u.pathname.match(/^\/j\/([A-Za-z0-9_-]+)\/?$/);
      return m ? { shortcode: m[1] } : null;
    },
    api: ({ shortcode }) => `https://apply.workable.com/j/${shortcode}`,
    async followEmbed(res, { shortcode }) {
      if (res.status !== 301 && res.status !== 302) return null;
      let target;
      try { target = new URL(res.headers.get('location'), 'https://apply.workable.com'); }
      catch { return null; }
      if (target.protocol !== 'https:' || target.hostname !== 'apply.workable.com') return null;
      const m = target.pathname.match(/^\/([^/]+)\/j\/([A-Za-z0-9_-]+)\/?$/);
      if (!m || m[2] !== shortcode || !isSafeValue(m[1])) return null;
      return `https://apply.workable.com/api/v2/accounts/${m[1]}/jobs/${m[2]}`;
    },
    async interpret(res) {
      let posting;
      try { posting = await res.json(); } catch { return null; }
      return classifyWorkablePosting(posting);
    },
  },
  {
    id: 'ashby',
    // jobs.ashbyhq.com/{org}/{jobId}[/application]. Ashby's public posting API is
    // ORG-level (the whole job board), not per-job — so `api` maps to the board and
    // `interpret` confirms this {jobId} is still listed. Only {org} reaches the
    // fixed-host URL; {jobId} is used solely to filter the parsed board (SAFE_SEGMENT
    // still validates both).
    match(u) {
      if (atsVendorOf(u.href) !== 'ashby' || u.hostname !== 'jobs.ashbyhq.com') return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/application)?\/?$/);
      return m ? { org: m[1], jobId: m[2] } : null;
    },
    api: ({ org }) => `https://api.ashbyhq.com/posting-api/job-board/${org}`,
    // Ashby's posting-api has a server-side latency floor and rate-limits repeated
    // unauthenticated hits (see providers/ashby.mjs). Give it more room than the ATS
    // default so a slow-but-live board doesn't time out into a Playwright fallback.
    timeoutMs: 20_000,
    // The API is board-level, so a 404 means the board API is off for this org
    // (embed-only boards such as Whatnot, providers/ashby.mjs `ashby.embed`) or
    // the slug is wrong. Neither says THIS posting is gone: removal shows as a
    // 200 board that no longer lists the id (`ashby_api_unlisted`).
    api404Authoritative: false,
    // One board answers for every posting under the org, so a caller checking
    // several postings can pass checkLivenessViaApi a `boardCache` and fetch it
    // once (check-liveness.mjs does, per run).
    interpretBoard: (json, { jobId }) => classifyAshbyBoard(json, jobId),
    async interpret(res, { jobId }) {
      let json;
      try {
        json = await res.json();
      } catch {
        return null; // unparseable body → inconclusive, let the browser decide
      }
      return classifyAshbyBoard(json, jobId);
    },
  },
  {
    id: 'workday',
    // {tenant}.{shard}.myworkdayjobs.com[/{xx-XX}]/{site}/job/{jobPath...}
    // Mirrors the tenant/shard/site detection in providers/workday.mjs, but for a
    // single posting rather than the board-wide CXS search endpoint. Workday's
    // per-job CXS endpoint (`/wday/cxs/{tenant}/{site}/job/{jobPath}`) is a
    // genuinely PER-JOB API like Greenhouse/Lever: a live posting returns 200, a
    // missing one returns 404, and a withdrawn posting returns a structured 403,
    // whose body classifyWorkday403 reads.
    //
    // jobPath is intentionally multi-segment (Workday encodes a location slug and
    // a title slug as separate path parts, e.g.
    // "Toronto-ON-CAN/Agentic-AI-Engineer_R260010125") — isSafeValue (not the
    // single-segment SAFE_SEGMENT check other providers use directly) validates
    // it component-by-component.
    match(u) {
      if (atsVendorOf(u.href) !== 'workday') return null;
      const m = `${u.hostname}${u.pathname}`.match(
        /^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/(.+?)\/?$/
      );
      if (!m) return null;
      const [, tenant, shard, site, jobPath] = m;
      return { tenant, shard, site, jobPath };
    },
    api: ({ tenant, shard, site, jobPath }) =>
      `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job/${jobPath}`,
    interpretStatuses: [403],
    async interpret(res) {
      let json;
      try {
        json = await res.json();
      } catch {
        return null; // unparseable body (e.g. a WAF HTML interstitial) → inconclusive
      }
      return classifyWorkday403(json);
    },
  },
  {
    id: 'smartrecruiters',
    match(u) {
      if (u.hostname !== 'jobs.smartrecruiters.com') return null;
      const m = u.pathname.match(/^\/([^/]+)\/([A-Za-z0-9]+)(?:-[^/]*)?\/?$/);
      return m ? { company: m[1], id: m[2] } : null;
    },
    api: ({ company, id }) => `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`,
    api404Authoritative: false, // the API also uses 400 for unknown IDs
    async interpret(res, { id }) {
      let posting;
      try { posting = await res.json(); } catch { return null; }
      if (String(posting?.id) !== id || typeof posting.active !== 'boolean') return null;
      return posting.active
        ? { result: 'active', code: 'smartrecruiters_api_active', reason: 'SmartRecruiters marks the posting active' }
        : { result: 'expired', code: 'smartrecruiters_api_inactive', reason: 'SmartRecruiters marks the posting inactive' };
    },
  },
  {
    id: 'zoho-recruit',
    // {tenant}.zohorecruit.<regional tld>/jobs/{portal}/{id}[/{slug}]. Zoho Recruit has no
    // JSON endpoint; the posting page itself embeds the record (see
    // providers/zoho-recruit.mjs), so `api` is that page and `interpret` reads
    // it. Zoho answers 200 for a removed posting too, so liveness comes from
    // the body, never from the status.
    match(u) {
      const host = u.hostname.match(ZOHO_HOST_RE);
      if (!host) return null;
      const m = u.pathname.match(/^\/jobs\/([^/]+)\/(\d+)(?:\/[^/]*)?\/?$/);
      return m ? { tenant: host[1], host: u.hostname, portal: m[1], id: m[2] } : null;
    },
    api: ({ host, portal, id }) => `https://${host}/jobs/${portal}/${id}`,
    accept: 'text/html',
    async interpret(res, { id }) {
      let html;
      try { html = await res.text(); } catch { return null; }
      return classifyZohoPostingPage(html, id);
    },
  },
  {
    id: 'ultipro',
    // {host}/{tenant}/JobBoard/{boardId}/OpportunityDetail?opportunityId={id}, the
    // URL providers/ultipro.mjs writes. Like Zoho Recruit, UKG has no per-posting
    // JSON endpoint: the detail page embeds the record (see providers/ultipro.mjs)
    // and answers 200 for a closed posting too, so `interpret` reads the body.
    //
    // The browser reads a closed posting here as uncertain: it either keeps its
    // page without an Apply control or gets the board's near-empty page, and on
    // 2026-10-28 all 57 closed postings read uncertain. Measured that day on 156
    // postings across 24 tenants, against each board's own listing: 99 listed
    // postings carried an open record, 14 unlisted ones a closed record and 42
    // the empty page's notice; the last, an internal-only posting, stays with
    // the browser.
    match(u) {
      if (!ULTIPRO_HOST_RE.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/([^/]+)\/JobBoard\/([^/]+)\/OpportunityDetail\/?$/);
      const id = u.searchParams.get('opportunityId');
      if (!m || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
      // UKG reads the id in any case and answers with the record's own lower-case id.
      return { host: u.hostname, tenant: m[1], boardId: m[2], id: id.toLowerCase() };
    },
    api: ({ host, tenant, boardId, id }) => `https://${host}/${tenant}/JobBoard/${boardId}/OpportunityDetail?opportunityId=${id}`,
    accept: 'text/html',
    async interpret(res, { id }) {
      let html;
      try { html = await res.text(); } catch { return null; }
      return classifyUltiproDetailPage(html, id);
    },
  },
  {
    id: 'arbeitsagentur',
    match(u) {
      if (u.hostname !== 'www.arbeitsagentur.de') return null;
      const m = u.pathname.match(/^\/jobsuche\/jobdetail\/([^/]+)\/?$/);
      return m ? { refnr: m[1] } : null;
    },
    api: ({ refnr }) => `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/${Buffer.from(refnr).toString('base64url')}`,
    headers: { 'X-API-Key': 'jobboerse-jobsuche' },
    api404Authoritative: false, // no expired real-job control; absence stays unknown
    async interpret(res, { refnr }) {
      let posting;
      try { posting = await res.json(); } catch { return null; }
      return posting?.referenznummer === refnr && posting?.stellenangebotsTitel
        ? { result: 'active', code: 'arbeitsagentur_api_active', reason: 'Arbeitsagentur returns the matching job detail' }
        : null;
    },
  },
  {
    id: 'weworkremotely',
    match(u) {
      if (u.hostname !== 'weworkremotely.com' || !/^\/remote-jobs\/[^/]+\/?$/.test(u.pathname)) return null;
      return { slug: u.pathname.split('/')[2] };
    },
    api: () => 'https://weworkremotely.com/remote-jobs.rss',
    accept: 'application/rss+xml',
    api404Authoritative: false,
    async interpret(res, { slug }) {
      let feed;
      try { feed = await res.text(); } catch { return null; }
      if (!/<rss\b/i.test(feed)) return null;
      const listed = parseWwrFeed(feed).some((job) => new URL(job.url).pathname.replace(/\/$/, '') === `/remote-jobs/${slug}`);
      return listed
        ? { result: 'active', code: 'weworkremotely_feed_listed', reason: 'Posting is listed in the current RSS feed' }
        : null; // feed is bounded; absence cannot prove expiry
    },
  },
  {
    id: 'linkedin',
    // linkedin.com/jobs/view/{id} · .../jobs/view/{title-slug}-{id} · any page that
    // carries the posting in ?currentJobId= (search and collection views).
    //
    // LinkedIn had no rung here, so every LinkedIn URL fell through to Playwright —
    // where /jobs/view/{id} redirects to a generic search page and no verdict can be
    // trusted. The guest endpoint below returns the rendered posting as HTML with no
    // auth and no browser, and it answers 200 for closed postings as well as live
    // ones, so liveness has to come from the body (`interpret`), never from the
    // status code alone.
    match(u) {
      const id = linkedInJobId(u);
      return id ? { id } : null;
    },
    api: ({ id }) => linkedInGuestUrl(id),
    // The endpoint is unauthenticated and rate-limited. Space our calls; the
    // interval sits on the provider so it holds for every caller rather than only
    // the loop in check-liveness.mjs.
    throttleMs: 3_500,
    // We parse HTML here, so ask for it. The endpoint also serves HTML under an
    // application/json Accept, but a request that misdescribes what it wants is one
    // content-negotiation change away from breaking silently.
    accept: 'text/html',
    async interpret(res) {
      let html;
      try {
        html = await res.text();
      } catch {
        return null; // unreadable body → inconclusive, let the browser decide
      }
      return classifyLinkedInPosting(html);
    },
  },
  {
    id: 'nofluffjobs',
    // nofluffjobs.com/pl/job/{slug}, the URL providers/nofluffjobs.mjs writes, and
    // the same posting under /job/{slug} or another language prefix.
    //
    // The browser reads this board backwards (#4832). A live posting puts "Aplikuj"
    // inside a <header> (the posting's own apply block), which the control walk
    // skips as page chrome: 40 of 40 live postings read no_apply_control on
    // 2026-10-18. A closed posting answers 200 and then moves to a search page
    // (/pl/?criteria=...), where an "APLIKUJ ›" promo link reads as an Apply
    // control: 42 of 59 closed postings read active. The board's public
    // per-posting API needs no browser and says which it is.
    match(u) {
      if (u.hostname !== 'nofluffjobs.com' && u.hostname !== 'www.nofluffjobs.com') return null;
      const m = u.pathname.match(/^\/(?:[a-z]{2}\/)?job\/([A-Za-z0-9-]+)\/?$/);
      return m ? { slug: m[1] } : null;
    },
    api: ({ slug }) => `https://nofluffjobs.com/api/posting/${slug}`,
    // Measured 2026-10-18: a live posting answers 200 with status "PUBLISHED", a
    // closed one 200 with status "EXPIRED" (and expiredBeforeDays), and a slug the
    // board does not have 404 {"status":"DOES_NOT_EXIST"}. The 404 body is read
    // too, so only that answer closes a posting, which scan --verify records for
    // good: a 404 saying anything else falls back to the browser.
    interpretStatuses: [200, 404],
    async interpret(res) {
      let posting;
      try { posting = await res.json(); } catch { return null; }
      return classifyNoFluffJobsPosting(posting, res.status);
    },
  },
  {
    id: 'tencent',
    // careers.tencent.com/jobdesc.html?postId={id}, the URL providers/tencent.mjs
    // writes. It usually copies the API's own PostURL, which is plain http (1,920
    // of 2,250 postings on 2026-10-18). The API host is fixed, so the page's
    // scheme is accepted, as for greenhouse-embedded.
    //
    // The browser reads this board wrong both ways (#4832): a live posting's
    // 申请岗位 is not an Apply label it knows (no_apply_control, dropped by
    // scan --verify), and a closed posting moves to /404.html served with a 200
    // (uncertain, kept by scan --verify). The per-posting endpoint the page
    // itself calls tells the two apart.
    acceptsHttp: true,
    match(u) {
      if (u.hostname !== 'careers.tencent.com' || u.pathname !== '/jobdesc.html') return null;
      const id = u.searchParams.get('postId');
      return id && /^\d+$/.test(id) ? { id } : null;
    },
    api: ({ id }) => `https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${id}&language=zh-cn`,
    // Measured 2026-10-18: a live posting answers 200 {"Code":200,"Data":{…}},
    // a closed one HTTP 500 {"Code":500,"Data":"E1005"}.
    interpretStatuses: [200, 500],
    api404Authoritative: false, // a closed posting has its own answer
    throttleMs: 1_000,
    async interpret(res, { id }) {
      let json;
      try { json = await res.json(); } catch { return null; }
      return classifyTencentPost(json, id);
    },
  },
  {
    id: 'meituan',
    // zhaopin.meituan.com/web/position/detail?jobUnionId={id}, the URL
    // providers/meituan.mjs writes. The browser misses a live posting's 立即申请
    // (no_apply_control, dropped by scan --verify), and a closed posting's page
    // keeps the same button (#4832), so no Apply label can tell the two apart.
    // The getJobDetail endpoint the page calls can, and it only answers a POST
    // (a GET gets status 0 "请求方式不正确！").
    match(u) {
      if (u.hostname !== 'zhaopin.meituan.com' || u.pathname !== '/web/position/detail') return null;
      const id = u.searchParams.get('jobUnionId');
      return id && /^\d+$/.test(id) ? { id } : null;
    },
    api: () => 'https://zhaopin.meituan.com/api/official/job/getJobDetail',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: ({ id }) => JSON.stringify({ jobUnionId: id, jobShareType: '1' }),
    api404Authoritative: false, // a closed posting has its own answer, a 200
    throttleMs: 1_000,
    async interpret(res, { id }) {
      let json;
      try { json = await res.json(); } catch { return null; }
      return classifyMeituanJob(json, id);
    },
  },
  {
    id: 'alibaba',
    // talent.alibaba.com/off-campus/position-detail?positionId={id}, the URL
    // providers/alibaba.mjs writes. The site does not deep-link (#2055): that
    // page lands on the home page for any posting, so the browser rung cannot
    // tell a live posting from a closed one and only this rung can.
    match(u) {
      if (u.hostname !== 'talent.alibaba.com' || u.pathname !== '/off-campus/position-detail') return null;
      const id = u.searchParams.get('positionId');
      // The id goes out as a JSON number, as the site sends it; up to 15
      // digits it converts exactly.
      return id && /^\d{1,15}$/.test(id) ? { id } : null;
    },
    api: () => 'https://talent.alibaba.com/position/detail',
    method: 'POST',
    // The stateless double-submit check providers/alibaba.mjs passes with a
    // fresh UUID per run: any matching cookie and header are accepted (this
    // constant measured 2026-10-18), so it needs no pre-request. Without the
    // pair the endpoint answers 403, and a GET 405.
    headers: { 'content-type': 'application/json', cookie: 'XSRF-TOKEN=career-ops', 'x-xsrf-token': 'career-ops' },
    body: ({ id }) => JSON.stringify({ id: Number(id), channel: 'group_official_site' }),
    api404Authoritative: false, // a closed posting has its own answer, a 200
    throttleMs: 1_000,
    async interpret(res, { id }) {
      let json;
      try { json = await res.json(); } catch { return null; }
      return classifyAlibabaPosition(json, id);
    },
  },
  {
    id: 'vdab',
    // www.vdab.be/vindeenjob/vacatures/{id}, the URL providers/vdab.mjs writes;
    // older links add a title slug after the id.
    //
    // A closed vacancy keeps its page and its "Solliciteer nu" button, and only
    // a banner says it is closed, "Deze vacature is niet meer gepubliceerd"
    // (#5244). The browser reads the page while it renders: on 2026-10-22 it
    // read 13 of 87 loads of unpublished vacancies active (the button rendered
    // before the banner) and 5 no_apply_control, as it did 2 of 40 loads of
    // published ones. The detail endpoint the page itself calls has no render
    // to wait for.
    match(u) {
      if (u.hostname !== 'www.vdab.be' && u.hostname !== 'vdab.be') return null;
      const m = u.pathname.match(/^\/vindeenjob\/vacatures\/(\d+)(?:\/[^/]+)?\/?$/);
      return m ? { id: m[1] } : null;
    },
    api: ({ id }) => `https://www.vdab.be/rest/vindeenjob/v4/vacatures/${id}?preview=false`,
    // Without the key the endpoint answers 403, which falls back to the browser,
    // so a rotated key costs this rung, not the check.
    headers: { 'vej-key-monitor': VEJ_KEY_MONITOR },
    // Measured 2026-10-22: a published vacancy answers 200 with gepubliceerd
    // true, an unpublished one 200 with gepubliceerd false and a status, and an
    // id VDAB never had 404 {"code":"NOT_FOUND"}. The 404 body is read too, so
    // a 404 saying anything else falls back to the browser instead of closing
    // the vacancy for good, and so does a 410, which VDAB never answered.
    interpretStatuses: [200, 404],
    api404Authoritative: false,
    async interpret(res, { id }) {
      let json;
      try { json = await res.json(); } catch { return null; }
      return classifyVdabVacancy(json, id, res.status);
    },
  },
];

// LinkedIn renders a closed posting with an explicit banner
// (`<figcaption class="closed-job__flavor--closed">No longer accepting
// applications</figcaption>`) and drops the apply control. A live posting shows one
// of two apply controls: the on-site button, or the off-site sign-in modal.
const LINKEDIN_CLOSED_MARKER = /No longer accepting applications/i;
const LINKEDIN_APPLY_CONTROL = /public_jobs_apply-link-onsite|job-details-topcard-apply-modal/;

/**
 * Decide liveness for one LinkedIn posting from its guest-endpoint HTML.
 * Pure + deterministic (no I/O), mirroring classifyLiveness in liveness-core.mjs.
 *
 * The two signals are read independently and must agree before this concludes
 * anything. A body carrying the closed banner AND an apply control, or neither, is
 * a page we do not recognise — a layout change, a partial render, an interstitial —
 * and it returns `uncertain` rather than picking the likelier answer.
 *
 * The asymmetry is deliberate and is the whole reason for the two-signal rule, and
 * it is this module's CONSERVATIVE BY DESIGN rule applied to a body read rather than
 * a status code: a wrong `expired` costs the user a real job they never see again,
 * while a wrong `uncertain` costs one re-check on the next sweep.
 *
 * @param {any} html - the guest endpoint's response body
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 *   null = nothing to read (empty or non-string body) → caller falls back.
 */
export function classifyLinkedInPosting(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const closed = LINKEDIN_CLOSED_MARKER.test(html);
  const apply = LINKEDIN_APPLY_CONTROL.test(html);
  if (closed && !apply) {
    return {
      result: 'expired',
      code: 'linkedin_closed_marker',
      reason: 'LinkedIn shows "No longer accepting applications" and no apply control',
    };
  }
  if (apply && !closed) {
    return {
      result: 'active',
      code: 'linkedin_apply_control',
      reason: 'LinkedIn shows an apply control and no closure banner (live)',
    };
  }
  return {
    result: 'uncertain',
    code: 'linkedin_signals_disagree',
    reason: closed
      ? 'LinkedIn shows both a closure banner and an apply control — unrecognised page'
      : 'LinkedIn shows neither a closure banner nor an apply control — unrecognised page',
  };
}

// Reserved send times per provider, so back-to-back callers queue behind each
// other instead of all reading the same "last request" timestamp and firing
// together.
const nextRequestAt = new Map();

/**
 * Wait until this provider's next request slot, then reserve the one after it.
 *
 * @param {string} providerId
 * @param {number} [intervalMs] - minimum spacing; falsy means no throttling
 * @returns {Promise<number>} milliseconds actually waited
 */
export async function throttleProviderRequest(providerId, intervalMs) {
  if (!intervalMs) return 0;
  const now = Date.now();
  const earliest = Math.max(now, nextRequestAt.get(providerId) ?? 0);
  nextRequestAt.set(providerId, earliest + intervalMs);
  const wait = earliest - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return wait;
}

/**
 * Decide liveness for one Ashby posting from its org's job-board API payload.
 * Pure + deterministic (no I/O), mirroring classifyLiveness in liveness-core.mjs.
 *
 * The public board lists only currently-published postings, so a posting that is
 * absent (or explicitly `isListed: false`) has been removed/unlisted → expired.
 * A present, listed posting → active. An unexpected shape → null (inconclusive),
 * so a future API change degrades to a Playwright fallback rather than a false
 * "expired".
 *
 * @param {any} json - parsed job-board response, expected shape `{ jobs: [...] }`
 * @param {string} jobId - the {jobId} from jobs.ashbyhq.com/{org}/{jobId}
 * @returns {{ result: 'active' | 'expired', code: string, reason: string } | null}
 */
export function classifyAshbyBoard(json, jobId) {
  if (!json || !Array.isArray(json.jobs)) return null; // unexpected shape → fall back
  const target = String(jobId).toLowerCase();
  const job = json.jobs.find((j) => typeof j?.id === 'string' && j.id.toLowerCase() === target);
  if (job && job.isListed !== false) {
    return { result: 'active', code: 'ashby_api_ok', reason: 'Ashby posting is listed on the board (live)' };
  }
  return { result: 'expired', code: 'ashby_api_unlisted', reason: 'Ashby posting not listed on the board — removed/unlisted' };
}

/**
 * Decide liveness for one Workable posting from its v2 endpoint JSON.
 * Pure + deterministic (no I/O), mirroring classifyLiveness in liveness-core.mjs.
 *
 * The live shape measured against a real posting is `state: "published"` (#5000);
 * every other readable state stays `uncertain` rather than expired, because the
 * endpoint is authoritative in the removed direction through its 404 alone, and a
 * state this rung does not recognise is exactly the case the browser rung cannot
 * improve on: Workable pages render client-side, so the fallback would call a live
 * posting expired. An unreadable body returns null so a future API change degrades
 * to the browser rung rather than to a verdict.
 *
 * @param {any} posting - the parsed v2 endpoint response
 * @returns {{ result: 'active' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyWorkablePosting(posting) {
  if (!posting || typeof posting !== 'object') return null;
  if (posting.state === 'published') {
    return { result: 'active', code: 'workable_api_published', reason: 'Workable reports the posting published (live)' };
  }
  return {
    result: 'uncertain',
    code: 'workable_state_unrecognised',
    reason: `Workable reports state ${String(posting.state)}; not a verdict this rung can make`,
  };
}

/**
 * Decide liveness for one No Fluff Jobs posting from its /api/posting/{slug} answer.
 * Pure + deterministic (no I/O), mirroring classifyWorkablePosting.
 *
 * "PUBLISHED" is live and "EXPIRED" is the board's own word for closed; on a 404,
 * only "DOES_NOT_EXIST" says the posting is gone. Any other status on a 200 is one
 * this rung has not seen, so it stays uncertain rather than falling to the
 * browser, which reads most closed postings on this board as active. A body with
 * no status, and a 404 saying anything else, return null so a future API change
 * degrades to the browser rung rather than to a verdict.
 *
 * @param {any} posting - the parsed per-posting API response
 * @param {number} [httpStatus=200] - the response's HTTP status (200 or 404)
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyNoFluffJobsPosting(posting, httpStatus = 200) {
  if (!posting || typeof posting !== 'object' || typeof posting.status !== 'string' || !posting.status) return null;
  if (httpStatus === 404) {
    return posting.status === 'DOES_NOT_EXIST'
      ? { result: 'expired', code: 'nofluffjobs_api_gone', reason: 'No Fluff Jobs has no posting under this slug (404 DOES_NOT_EXIST)' }
      : null;
  }
  if (posting.status === 'PUBLISHED') {
    return { result: 'active', code: 'nofluffjobs_api_published', reason: 'No Fluff Jobs reports the posting published (live)' };
  }
  if (posting.status === 'EXPIRED') {
    const days = Number.isFinite(posting.expiredBeforeDays) ? ` ${posting.expiredBeforeDays} day(s) ago` : '';
    return { result: 'expired', code: 'nofluffjobs_api_expired', reason: `No Fluff Jobs reports the posting expired${days}` };
  }
  return {
    result: 'uncertain',
    code: 'nofluffjobs_status_unrecognised',
    reason: `No Fluff Jobs reports status ${String(posting.status)}; not a verdict this rung can make`,
  };
}

// True when an id read from a board's answer is THIS posting's id: the same
// string, or a safe integer that prints as it. An array, an object, or a number
// too large to be exact (a 19-digit Tencent id parsed as a number) never matches.
function isSameId(value, id) {
  if (typeof value === 'string') return value === id;
  return Number.isSafeInteger(value) && String(value) === id;
}

/**
 * Decide liveness for one Tencent posting from its ByPostId answer (HTTP 200 or
 * 500). Pure + deterministic (no I/O), mirroring classifyNoFluffJobsPosting.
 *
 * `Code 200` carrying THIS PostId is live. `Code 500` with `Data: "E1005"` is
 * the board's answer for a posting it no longer has; an id that never existed
 * gets it too, and neither belongs in the pipeline. Any other readable answer,
 * a Code 200 for another PostId included, stays uncertain rather than falling
 * to the browser, which misreads this board both ways (#4832). An unreadable
 * body returns null so the browser rung decides.
 *
 * @param {any} json - parsed ByPostId body
 * @param {string} postId - the postId query parameter of the posting URL
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyTencentPost(json, postId) {
  if (!json || typeof json !== 'object') return null;
  if (json.Code === 200 && isSameId(json.Data?.PostId, postId)) {
    return { result: 'active', code: 'tencent_api_active', reason: 'Tencent returns the posting (live)' };
  }
  if (json.Code === 500 && json.Data === 'E1005') {
    return { result: 'expired', code: 'tencent_api_e1005', reason: 'Tencent answers E1005: posting closed or removed' };
  }
  // Data is a string on every non-200 answer seen; name anything else by its type.
  const data = typeof json.Data === 'string' ? json.Data.slice(0, 80) : json.Data === null ? 'null' : typeof json.Data;
  return {
    result: 'uncertain',
    code: 'tencent_answer_unrecognised',
    reason: json.Code === 200
      ? 'Tencent answers Code 200 without this PostId; not a verdict this rung can make'
      : `Tencent answers Code ${String(json.Code)}, Data ${data}; not a verdict this rung can make`,
  };
}

/**
 * Decide liveness for one Meituan posting from its getJobDetail answer.
 * Pure + deterministic (no I/O), mirroring classifyTencentPost.
 *
 * A closed posting keeps `status: 1` and its whole record; only `jobStatus`
 * changes, from "000" (live) to "001" (closed). Any other readable answer
 * (another jobStatus, a record for another id, or `status: 0` "职位已下线或不存在！",
 * seen only for ids that never existed and for a wrong request method) stays
 * uncertain rather than falling to the browser, which cannot tell live from
 * closed on this board (#4832). An unreadable body returns null so the browser
 * rung decides.
 *
 * @param {any} json - parsed getJobDetail body
 * @param {string} jobUnionId - the jobUnionId query parameter of the posting URL
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyMeituanJob(json, jobUnionId) {
  if (!json || typeof json !== 'object') return null;
  if (json.status !== 1 || !isSameId(json.data?.jobUnionId, jobUnionId)) {
    return {
      result: 'uncertain',
      code: 'meituan_answer_unrecognised',
      reason: json.status === 1
        ? 'Meituan answers status 1 without this jobUnionId; not a verdict this rung can make'
        : `Meituan answers status ${String(json.status)}; not a verdict this rung can make`,
    };
  }
  if (json.data.jobStatus === '000') {
    return { result: 'active', code: 'meituan_api_open', reason: 'Meituan reports jobStatus "000" (live)' };
  }
  if (json.data.jobStatus === '001') {
    return { result: 'expired', code: 'meituan_api_closed', reason: 'Meituan reports jobStatus "001" (closed)' };
  }
  return {
    result: 'uncertain',
    code: 'meituan_answer_unrecognised',
    reason: `Meituan reports jobStatus ${String(json.data.jobStatus)}; not a verdict this rung can make`,
  };
}

/**
 * Decide liveness for one Alibaba posting from its position/detail answer.
 * Pure + deterministic (no I/O), mirroring classifyTencentPost.
 *
 * Every measured answer was a 200 with `success: true`. A `content` carrying
 * THIS id is live, and `content: null` is the answer for a posting the board
 * no longer has (or never had). Any other readable answer, a failed call
 * (`success` not true, the in-band error providers/alibaba.mjs also checks) or
 * a record for another id, stays uncertain rather than falling to the browser,
 * which cannot tell live from closed on this board (#2055). An unreadable body
 * returns null so the browser rung decides.
 *
 * @param {any} json - parsed position/detail body
 * @param {string} id - the positionId query parameter of the posting URL
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyAlibabaPosition(json, id) {
  if (!json || typeof json !== 'object') return null;
  if (json.success === true && json.content === null) {
    return { result: 'expired', code: 'alibaba_api_no_content', reason: 'Alibaba returns no position for the id: closed or removed' };
  }
  if (json.success === true && isSameId(json.content?.id, id)) {
    return { result: 'active', code: 'alibaba_api_active', reason: 'Alibaba returns the position (live)' };
  }
  return {
    result: 'uncertain',
    code: 'alibaba_answer_unrecognised',
    reason: json.success === true
      ? 'Alibaba answers success true without this position id; not a verdict this rung can make'
      : `Alibaba answers success ${String(json.success)}, errorCode ${String(json.errorCode)}; not a verdict this rung can make`,
  };
}

/**
 * Decide liveness for one VDAB vacancy from its detail answer (HTTP 200 or 404).
 * Pure + deterministic (no I/O), mirroring classifyNoFluffJobsPosting.
 *
 * `gepubliceerd` is what the page's closed banner reports ("Deze vacature is
 * niet meer gepubliceerd"): true is live. An unpublished vacancy's `status`
 * says why. PASSIEF is closed. HANGEND (pending) also covers vacancies VDAB has
 * not published yet, so it stays uncertain: an expired verdict is one
 * scan --verify records for good. An unpublished status this rung has not seen
 * stays uncertain too. On a 404, only NOT_FOUND says the id is gone. A record
 * for another vacancy, or one without the flag, returns null so the browser
 * rung decides.
 *
 * @param {any} json - the parsed detail response
 * @param {string} id - the vacancy id from the posting URL
 * @param {number} [httpStatus=200] - the response's HTTP status (200 or 404)
 * @returns {{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null}
 */
export function classifyVdabVacancy(json, id, httpStatus = 200) {
  if (!json || typeof json !== 'object') return null;
  if (httpStatus === 404) {
    return json.code === 'NOT_FOUND'
      ? { result: 'expired', code: 'vdab_api_gone', reason: 'VDAB has no vacancy under this id (404 NOT_FOUND)' }
      : null;
  }
  if (!isSameId(json.referentie?.id, id) || typeof json.gepubliceerd !== 'boolean') return null;
  if (json.gepubliceerd) {
    return { result: 'active', code: 'vdab_api_published', reason: 'VDAB reports the vacancy published (live)' };
  }
  if (json.status === 'PASSIEF') {
    return { result: 'expired', code: 'vdab_api_closed', reason: 'VDAB reports the vacancy no longer published (PASSIEF)' };
  }
  if (json.status === 'HANGEND') {
    return { result: 'uncertain', code: 'vdab_api_pending', reason: 'VDAB reports the vacancy pending (HANGEND): not published, and not closed' };
  }
  return {
    result: 'uncertain',
    code: 'vdab_status_unrecognised',
    reason: `VDAB reports the vacancy unpublished with status ${String(json.status)}; not a verdict this rung can make`,
  };
}

/**
 * Decide liveness for one Zoho Recruit posting from its own page.
 * Pure + deterministic (no I/O), mirroring classifyAshbyBoard.
 *
 * A live posting page embeds its record; a record for THIS id marked
 * `Is_Locked` or unpublished is a posting the career site shows as filled
 * (expired), any other record for it is live. A removed posting is a 200 page
 * with no record and Zoho's "This job posting is no longer available." notice.
 * Anything else (a record for another id, an error page, a markup change)
 * returns null so the browser rung decides.
 *
 * @param {any} html - the posting page's body
 * @param {string} id - the {id} path segment from the posting URL
 * @returns {{ result: 'active' | 'expired', code: string, reason: string } | null}
 */
export function classifyZohoPostingPage(html, id) {
  if (typeof html !== 'string' || !html) return null;
  const record = parseZohoDetailPage(html);
  if (record) {
    if (String(record.id) !== String(id)) return null;
    return isZohoRecordClosed(record)
      ? { result: 'expired', code: 'zoho_recruit_filled', reason: 'Zoho Recruit marks the posting locked or unpublished (filled)' }
      : { result: 'active', code: 'zoho_recruit_page_ok', reason: 'Zoho Recruit posting page carries the open posting (live)' };
  }
  return /This job posting is no longer available/i.test(html)
    ? { result: 'expired', code: 'zoho_recruit_unavailable', reason: 'Zoho Recruit shows "This job posting is no longer available."' }
    : null;
}

// The notice on UKG's empty detail page, the one the browser shows as "This
// opportunity is currently not available." An internal-only posting's page has
// no record either, but carries a sign-in notice instead, so it does not match.
const ULTIPRO_UNAVAILABLE_NOTICE = 'data-i18n="Opportunity.OpportunityError.OpportunityUnavailableMessage"';

/**
 * Decide liveness for one UltiPro (UKG Pro Recruiting) posting from its own
 * detail page. Pure + deterministic (no I/O), mirroring classifyZohoPostingPage.
 *
 * A posting's page embeds its record, and the record for THIS id says whether
 * it is closed: `OpportunityIsClosed` false is live, true is closed (a closed
 * posting can keep its whole page, only without an Apply control). A posting
 * UKG no longer shows gets the board's empty page: no record, and the
 * "opportunity unavailable" notice. Anything else (a record for another id or
 * without the flag, an internal-only notice, an error page, a markup change)
 * returns null so the browser rung decides.
 *
 * @param {any} html - the detail page's body
 * @param {string} id - the opportunityId from the posting URL
 * @returns {{ result: 'active' | 'expired', code: string, reason: string } | null}
 */
export function classifyUltiproDetailPage(html, id) {
  if (typeof html !== 'string' || !html) return null;
  let page;
  try {
    page = extractCandidateOpportunityDetail(html, id);
  } catch {
    return null; // a record for another id, or one that no longer parses
  }
  if (page.status === 'ok') {
    const closed = page.detail.OpportunityIsClosed;
    if (typeof closed !== 'boolean') return null;
    return closed
      ? { result: 'expired', code: 'ultipro_api_closed', reason: 'UKG marks the opportunity closed (OpportunityIsClosed)' }
      : { result: 'active', code: 'ultipro_api_open', reason: 'UKG marks the opportunity open (live)' };
  }
  return html.includes(ULTIPRO_UNAVAILABLE_NOTICE)
    ? { result: 'expired', code: 'ultipro_api_unavailable', reason: 'UKG shows "This opportunity is currently not available."' }
    : null;
}

/**
 * Decide liveness for one Workday posting from the body of a 403 on its per-job
 * CXS endpoint. Pure + deterministic (no I/O), mirroring classifyAshbyBoard.
 *
 * On this endpoint a live posting is a 200 and a missing one is a 404, both
 * concluded from the status alone by the generic path. A withdrawn posting is a
 * 403 whose JSON body carries `errorCode: "S22"`, "permission denied" — the
 * only case where the body decides. Only that exact S22 shape reads as expired;
 * any other 403 body — a WAF or bot-wall page, or a Workday error with a
 * different code — stays inconclusive.
 *
 * @param {any} json - parsed body of a 403 from the CXS per-job endpoint
 * @returns {{ result: 'expired', code: string, reason: string } | null}
 */
export function classifyWorkday403(json) {
  return json?.httpStatus === 403 && json?.errorCode === 'S22'
    ? { result: 'expired', code: 'workday_api_withdrawn', reason: 'Workday CXS answers 403 S22 — posting withdrawn' }
    : null;
}

/**
 * Map a posting URL to its ATS API URL, or null if it isn't a known ATS posting
 * (or any extracted segment fails the strict charset). Pure + deterministic.
 * @param {string} rawUrl
 * @returns {{ ats: string, apiUrl: string, method: string, body?: string, parts: Record<string, string>, timeoutMs?: number, throttleMs?: number, accept?: string, interpret?: (res: Response, parts: Record<string, string>) => Promise<{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null>, interpretStatuses?: number[], api404Authoritative: boolean } | null}
 */
export function resolveAtsApi(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const plainHttp = u.protocol === 'http:';
  for (const provider of ATS_PROVIDERS) {
    // Plain http resolves only for a provider that opts in: one whose API host is
    // fixed and never derived from the page URL, so the page's scheme is irrelevant.
    if (plainHttp && !provider.acceptsHttp) continue;
    const parts = provider.match(u);
    if (!parts) continue;
    // SSRF guard: every derived value must be safe — a single path segment for
    // most providers, or (Workday) a slash-separated sequence of safe segments.
    // isSafeValue enforces the same charset + no-".." rule either way.
    if (!Object.values(parts).every(isSafeValue)) return null;
    return {
      ats: provider.id,
      apiUrl: provider.api(parts),
      method: provider.method || 'GET',
      body: provider.body?.(parts),
      parts,
      timeoutMs: provider.timeoutMs,
      throttleMs: provider.throttleMs,
      accept: provider.accept,
      headers: provider.headers,
      followEmbed: provider.followEmbed,
      interpret: provider.interpret,
      interpretStatuses: provider.interpretStatuses,
      api404Authoritative: provider.api404Authoritative !== false,
      interpretBoard: provider.interpretBoard,
    };
  }
  return null;
}

/** True if `url` is an ATS posting we can check via API (lets callers stay lazy about the browser). */
export function isAtsPosting(url) {
  return resolveAtsApi(url) !== null;
}

// ATS ids whose public API returns the actual JD body (not just a liveness
// signal). Greenhouse (`content`), Lever (`descriptionPlain`), Ashby
// (`descriptionPlain` on the org board), Workday (`jobPostingInfo.jobDescription`
// on the per-job CXS endpoint) and SmartRecruiters (`jobAd.sections`) all ship
// full text for free in the same payload resolveAtsApi() already points at.
// greenhouse-embedded (a company careers page carrying only `?gh_jid=`) reaches
// the same per-job Greenhouse endpoint once its embed redirect names the board.
// Zoho Recruit has no JSON API; the posting page resolveAtsApi() points at
// embeds the record with its HTML `Job_Description`.
// Workable canonical and share links expose description, requirements and benefits
// on the per-posting v2 API, after the existing guarded account-resolution hop.
// Microsoft and LinkedIn are on ATS_PROVIDERS
// for liveness only — their public endpoints answer search/status, never body
// text — so they are deliberately excluded here; see fetch-jd.mjs / the
// fetch*Jd() family in browser-extract.mjs for the per-provider fetchers.
export const JD_TEXT_API_ATS = new Set(['greenhouse', 'greenhouse-embedded', 'lever', 'ashby', 'workday', 'smartrecruiters', 'zoho-recruit', 'workable', 'workable-short']);

/**
 * Zero-token liveness check via the posting's ATS API.
 * @param {string} url
 * @param {{ boardCache?: Map<string, unknown> }} [options]
 *   boardCache: for a provider whose API is the whole board (Ashby), the parsed
 *   board is kept here under its API URL and reused for the next posting on the
 *   same board. Only a 200 that parsed into a board is kept; anything else is
 *   retried next time.
 *   Without it, every posting fetches its board, as before.
 * @returns {Promise<{ result: 'active' | 'expired' | 'uncertain', code: string, reason: string } | null>}
 *   null = not a known ATS posting, or inconclusive → caller should fall back to Playwright.
 *   `uncertain` is a conclusion in its own right: the provider reached the posting
 *   and could not read it, and no other rung would do better.
 */
export async function checkLivenessViaApi(url, { boardCache } = {}) {
  const resolved = resolveAtsApi(url);
  if (!resolved) return null;
  const { ats, apiUrl, method, body, parts, interpret, interpretStatuses, timeoutMs, throttleMs, accept, headers, followEmbed, api404Authoritative, interpretBoard } = resolved;
  const cacheBoard = Boolean(boardCache && interpretBoard);
  // Checked before the throttle: a board already in hand costs no request.
  if (cacheBoard && boardCache.has(apiUrl)) return interpretBoard(boardCache.get(apiUrl), parts);

  // Wait out any provider rate limit BEFORE arming the timeout, so the spacing
  // does not eat the budget the request itself needs.
  await throttleProviderRequest(ats, throttleMs);

  // The timeout guards the whole classification (fetch + any `interpret` body read),
  // since aborting the shared signal also tears down an in-flight res.json().
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(apiUrl, {
        method,
        headers: { 'user-agent': DEFAULT_USER_AGENT, accept: accept || 'application/json', ...headers },
        body,
        redirect: followEmbed ? 'manual' : 'error',
        signal: controller.signal,
      });
      if (followEmbed) {
        const jobApiUrl = await followEmbed(res, parts);
        if (!jobApiUrl) return null;
        res = await fetch(jobApiUrl, {
          method: 'GET',
          headers: { 'user-agent': DEFAULT_USER_AGENT, accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
      }
    } catch {
      return null; // network / timeout / redirect → inconclusive, let Playwright decide
    }

    if ((res.status === 404 || res.status === 410) && !interpretStatuses?.includes(res.status)) {
      if (!api404Authoritative) return null; // inconclusive → let Playwright check the real page
      return { result: 'expired', code: `${ats}_api_gone`, reason: `ATS API ${res.status} — posting removed` };
    }
    // Providers with an `interpret` step read the body of the statuses they
    // list (by default the 200: org-level Ashby, and per-job APIs whose 200 can
    // still describe a closed posting); any other 200 is proof the posting is live.
    if (cacheBoard && res.status === 200) {
      let json;
      try {
        json = await res.json();
      } catch {
        return null; // unparseable body → inconclusive, and not cached
      }
      // Kept only when it classifies: a 200 whose body is not a board (no
      // `jobs` array) stays uncached, so the next posting retries the API.
      const verdict = interpretBoard(json, parts);
      if (verdict) boardCache.set(apiUrl, json);
      return verdict;
    }
    if (interpret && (interpretStatuses || [200]).includes(res.status)) return await interpret(res, parts);
    if (res.status === 200) {
      return { result: 'active', code: `${ats}_api_ok`, reason: 'ATS API returns the posting (live)' };
    }
    return null; // 429/5xx/other → inconclusive, fall back to the browser check
  } catch {
    return null; // interpret abort / unexpected error → inconclusive
  } finally {
    clearTimeout(timer);
  }
}
