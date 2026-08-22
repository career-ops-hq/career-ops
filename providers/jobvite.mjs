// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchTextWithRetry } from './_http.mjs';
// Shared decoder, not a private copy. This provider's stricter XML 1.0 §2.2 Char
// guard was upstreamed into _html-entities.mjs (#2623); keeping the local one
// only risked the two drifting apart again — which is the drift that module
// exists to end. The numeric references this feed really carries (`&#8217;`,
// `&#x2013;`) decode identically there.
import { decodeEntities } from './_html-entities.mjs';

// Jobvite provider — per-tenant public jobs feed.
// Used by ~3,000 companies across a wide range of industries.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS USES THE XML FEED AND NOT THE JSON API
//
// This provider previously fetched:
//
//   GET https://jobs.jobvite.com/api/company/{slug}/jobs
//
// That endpoint is retired: it answers 302 to `http://search.jobvite.com?invalid=1`,
// so the provider returned zero jobs rather than failing loudly.
//
// The tenant that proves it is tylertech — still a live Jobvite customer
// (companyEId q6NaVfwI, 236 jobs on the XML feed), yet dead on the JSON API.
// That is the case this fix restores. Five other slugs checked alongside it
// (zoom, starbucks, servicenow, twilio, blueorigin) 302 the same way, but they
// are NOT evidence for the same claim: re-verified 2026-08-11, those companies
// have migrated off Jobvite entirely, and their slugs answer identically on
// every Jobvite endpoint including the XML feed. A retired tenant and a retired
// API look alike from the outside; only a tenant that is live on one endpoint
// and dead on the other separates them.
//
// The working public feed is XML, on a DIFFERENT host:
//
//   GET https://app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}
//   <result><job>
//     <id>…</id><title>…</title><category>…</category>
//     <location>…</location><date>M/D/YYYY</date>
//     <detail-url><![CDATA[…]]></detail-url>
//     <apply-url><![CDATA[…]]></apply-url>
//   </job>…</result>
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TENANT IDENTIFIER CHANGED SHAPE
//
// The old API keyed on the vanity slug from the careers URL ("tylertech").
// The XML feed keys on an opaque `companyEId` ("q6NaVfwI") which does NOT
// appear in the careers URL — it is only in the board page's inline JS as
// `companyEId: 'q6NaVfwI'`.
//
// So a slug alone is no longer sufficient. Resolution order:
//   1. `company_eid:` on the portal entry            (explicit, no network)
//   2. `c=` query param of an explicit `api:` URL    (explicit, no network)
//   3. discovery: GET the board page and scrape it   (one extra request, cached)
//
// Prefer (1) in config — it is one line, survives board redesigns, and skips
// a request per scan. Discovery exists so an entry that only knows the vanity
// URL still works.
//
// ─────────────────────────────────────────────────────────────────────────────
// SSRF stance: both hosts are pinned by assertJobviteHost() before every fetch,
// and no redirect is ever followed. The board uses redirect:'error'; the feed
// uses redirect:'manual', which is the same guarantee by a different route —
// undici hands back the 3xx as a response instead of chasing it, so the final
// hostname still cannot move. 'manual' buys the ability to READ the Location
// header without acting on it, which is what separates an empty board from a
// retired tenant (see isEmptyBoardRedirect). The eId is used only as a
// query-param value, never as a path segment. Per-job apply/detail URLs are
// display-only (written to pipeline/history, never fetched here) and are
// accepted from any https: origin, since Jobvite tenants commonly brand them
// onto their own domain.
//
// Wire in via a `tracked_companies:` entry, cheapest form first:
//   careers_url: https://jobs.jobvite.com/{slug}
//   company_eid: {companyEId}
// or explicitly:
//   provider: jobvite
//   api: https://app.jobvite.com/CompanyJobs/Xml.aspx?c={companyEId}

const BOARD_HOST = 'jobs.jobvite.com';
const FEED_HOST = 'app.jobvite.com';
const ALLOWED_HOSTS = new Set([BOARD_HOST, FEED_HOST]);

// The XML feed inlines every job's FULL HTML description, so it is large and
// slow by construction rather than occasionally: Tyler Technologies returns
// 1.88 MB for 236 jobs in ~11s. That overshoots the shared 10s default in
// _http.mjs by a second, which aborted the whole tenant and reported it as a
// network failure. Sized to absorb a genuinely big tenant on a slow link; the
// board page (a normal HTML document) keeps the default.
const FEED_TIMEOUT_MS = 45_000;

/**
 * Pin a URL to the two known Jobvite hosts over HTTPS.
 * @param {string} url
 */
function assertJobviteHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobvite: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`jobvite: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname))
    throw new Error(`jobvite: untrusted hostname "${parsed.hostname}" — must be ${BOARD_HOST} or ${FEED_HOST}`);
  return url;
}

// NaN-safe Date.parse → epoch ms.
/** @param {string} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The vanity slug from a Jobvite careers URL, or null.
 * Only used to build the board URL for eId discovery.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveSlug(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== BOARD_HOST) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (!segments.length || segments[0] === 'api') return null;
  return segments[0];
}

/**
 * The companyEId from explicit config, without touching the network.
 * Returns null when the entry only carries a vanity slug.
 *
 * @param {import('./_types.js').PortalEntry & {company_eid?: string}} entry
 * @returns {string | null}
 */
export function resolveConfiguredEid(entry) {
  const direct = typeof entry.company_eid === 'string' ? entry.company_eid.trim() : '';
  if (direct) return direct;

  const api = typeof entry.api === 'string' ? entry.api.trim() : '';
  if (!api) return null;
  let parsed;
  try {
    parsed = new URL(api);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return null;
  const c = parsed.searchParams.get('c');
  return c && c.trim() ? c.trim() : null;
}

/**
 * Scrape `companyEId` out of a Jobvite board page.
 *
 * The board embeds it in inline JS as `companyEId: 'q6NaVfwI'`. Quoting and
 * spacing vary between tenants, hence the tolerant pattern. Exported so the
 * scrape can be unit-tested without a network call.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractEidFromBoard(html) {
  if (typeof html !== 'string' || !html) return null;
  const m = html.match(/companyEId\s*[:=]\s*['"]([A-Za-z0-9_-]{4,40})['"]/);
  return m ? m[1] : null;
}

/** @param {string} eid */
function buildFeedUrl(eid) {
  const u = new URL(`https://${FEED_HOST}/CompanyJobs/Xml.aspx`);
  u.searchParams.set('c', eid);
  return u.href;
}

/**
 * The tenant's public board URL, as a human would type it.
 *
 * Display-only: detect() reports it in logs, where the transport params below
 * are noise. Never fetched — see buildBoardFetchUrl.
 *
 * @param {string} slug
 */
function buildBoardUrl(slug) {
  return `https://${BOARD_HOST}/${encodeURIComponent(slug)}`;
}

/**
 * The board URL actually requested during eId discovery.
 *
 * `fr=true&nl=1` is what the branded-careers-page iframe requests, and it is
 * load-bearing for a whole class of tenant. Many Jobvite customers point their
 * public careers page at their own domain, and a bare `jobs.jobvite.com/{slug}`
 * 302s straight there — to `www.fieldcore.com/careers/jobs/`, say — so the
 * board HTML carrying `companyEId` is never served and discovery cannot start.
 * With these two params the listing renders inline instead of redirecting.
 *
 * Verified 2026-08-11 against live boards: fieldcore, imprivata and opentrons
 * all 302 away bare and answer 200 with an eId once the params are present. It
 * is a no-op where it is not needed — egnyte returns the same eId either way —
 * so it goes on every board request rather than being conditional on having
 * already failed.
 *
 * NOT applied to the feed. The redirect is a property of the branded board, not
 * of the tenant: the same three tenants' feeds answer 200 bare (fieldcore 126
 * jobs, imprivata 53). Adding undeclared params to the XML endpoint would be
 * cargo-culting a fix onto a request that never had the problem.
 *
 * @param {string} slug
 */
function buildBoardFetchUrl(slug) {
  const u = new URL(buildBoardUrl(slug));
  u.searchParams.set('fr', 'true');
  u.searchParams.set('nl', '1');
  return u.href;
}

/**
 * Retry policy for both Jobvite requests.
 *
 * `app.jobvite.com` rate-limits hard and early: it answers `429 Retry-After: 30`
 * from the second request onward, so a scan covering two Jobvite tenants
 * back-to-back already trips it — this is the normal path, not an edge case.
 * Confirmed live: a 200 (945 KB, 40 jobs) followed immediately by a 429, then a
 * 200 again once the 30s was honoured. So the wait genuinely clears it and
 * retrying is worth the wall-clock.
 *
 * maxDelayMs is raised from the shared 8s default purely to widen the
 * Retry-After clamp — `fetchTextWithRetry` honours the header up to
 * maxDelayMs * 4, and the shared default puts that at 32s, uncomfortably close
 * to Jobvite's advertised 30 for a value we do not control. 15s moves the
 * ceiling to 60s, leaving room for Jobvite to raise its window without the
 * clamp silently truncating the wait into another guaranteed 429.
 */
const RETRY_POLICY = { retries: 2, baseDelayMs: 1_000, maxDelayMs: 15_000 };

/**
 * Whether a thrown redirect is the feed saying "this board is empty".
 *
 * A tenant with no open positions does not get an empty `<result/>`; the feed
 * 302s to `NoJobs.htm` instead. Zero vacancies is a legitimate answer, not a
 * failure, so it must not surface as a broken tenant.
 *
 * Scoped deliberately tight — to a 3xx, on the feed host, whose target is that
 * one page. The board's own redirect (`search.jobvite.com?invalid=1`) means the
 * opposite thing, a slug that is no longer a Jobvite tenant at all, and has to
 * keep failing loudly rather than being laundered into "0 jobs today". Blanket
 * "treat any redirect as empty" would erase exactly that signal.
 *
 * The Location header is relative in practice (literally `NoJobs.htm`), so it
 * is resolved against the request URL before anything is compared.
 *
 * @param {any} err - Error from a redirect:'manual' fetch.
 * @param {string} requestUrl - The URL that produced it.
 */
function isEmptyBoardRedirect(err, requestUrl) {
  const status = err?.status;
  if (typeof status !== 'number' || status < 300 || status > 399) return false;
  if (!err.location) return false;
  let target;
  try {
    target = new URL(err.location, requestUrl);
  } catch {
    return false;
  }
  return target.hostname === FEED_HOST && target.pathname.toLowerCase().endsWith('/nojobs.htm');
}

/** @type {Provider} */
export default {
  id: 'jobvite',

  detect(entry) {
    const eid = resolveConfiguredEid(entry);
    if (eid) return { url: buildFeedUrl(eid) };
    // A vanity URL alone still identifies this provider; the eId is resolved
    // at fetch time via discovery.
    const slug = resolveSlug(entry);
    return slug ? { url: buildBoardUrl(slug) } : null;
  },

  async fetch(entry, ctx) {
    let eid = resolveConfiguredEid(entry);

    if (!eid) {
      const slug = resolveSlug(entry);
      if (!slug) throw new Error(`jobvite: cannot derive a company id for ${entry.name} — set company_eid: or an api: URL with ?c=`);
      const boardUrl = buildBoardFetchUrl(slug);
      assertJobviteHost(boardUrl);
      // redirect:'error' here, not 'manual'. A board that still redirects once
      // fr=true&nl=1 is present is a retired slug answering
      // search.jobvite.com?invalid=1, and that must fail loudly.
      const html = await fetchTextWithRetry(ctx, boardUrl, { redirect: 'error' }, RETRY_POLICY);
      eid = extractEidFromBoard(html);
      if (!eid) {
        throw new Error(
          `jobvite: could not find companyEId on ${boardUrl} for ${entry.name}. ` +
          `Set it explicitly with company_eid: (find it in the board page source as companyEId: '…').`,
        );
      }
    }

    const feedUrl = buildFeedUrl(eid);
    assertJobviteHost(feedUrl);
    try {
      const xml = await fetchTextWithRetry(
        ctx,
        feedUrl,
        { redirect: 'manual', timeoutMs: FEED_TIMEOUT_MS },
        RETRY_POLICY,
      );
      return parseJobviteXml(xml, entry.name);
    } catch (err) {
      // An empty board is reported as a redirect to NoJobs.htm rather than as
      // an empty feed — see isEmptyBoardRedirect. Anything else propagates.
      if (isEmptyBoardRedirect(err, feedUrl)) return [];
      throw err;
    }
  },
};

/**
 * Read one tag out of a `<job>` block, unwrapping CDATA.
 *
 * Deliberately index-based rather than a regex. The obvious pattern here —
 * `<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*</name>` — puts `\s*` either
 * side of a lazy `[\s\S]*?`, which is polynomial-backtracking on input that
 * never closes the tag, and this parser runs on a remote 1.9 MB document.
 * CodeQL flags it (js/polynomial-redos, high) and it is right to. Scanning with
 * indexOf is linear, allocation-light and easier to read.
 *
 * @param {string} block
 * @param {string} name
 */
function tagText(block, name) {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = block.indexOf(open);
  if (start === -1) return '';
  const from = start + open.length;
  const end = block.indexOf(close, from);
  if (end === -1) return '';

  let value = block.slice(from, end).trim();
  if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) {
    value = value.slice('<![CDATA['.length, -']]>'.length).trim();
  }
  return value;
}

/**
 * Parse a Jobvite `CompanyJobs/Xml.aspx` feed. Exported for unit tests.
 *
 * Field mapping:
 *   title    ← `<title>`                          (required; posting dropped when absent)
 *   url      ← `<detail-url>`, else `<apply-url>` (required; must be http(s))
 *   company  ← `entry.name`                       (the feed carries no company name)
 *   location ← `<location>`
 *   postedAt ← `<date>` (M/D/YYYY) → epoch ms     (omitted when absent/unparseable)
 *
 * `<detail-url>` is preferred over `<apply-url>` because it is the human-readable
 * posting page; the apply URL jumps straight into the application form, which is
 * a worse thing to write into the pipeline for a human to open.
 *
 * Feed URLs arrive as http: in practice. They are display-only — never fetched
 * here — so they are upgraded to https: rather than dropped, which would
 * discard every posting in the feed.
 *
 * @param {string} xml
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseJobviteXml(xml, companyName) {
  if (typeof xml !== 'string' || !xml) return [];

  const out = [];

  // Cursor scan rather than `xml.matchAll(/<job>([\s\S]*?)<\/job>/gi)`, for the
  // same reason tagText() avoids a regex. On a feed carrying many `<job>` starts
  // and no closing tag, the lazy matcher retries from each start and scans to the
  // end of the document every time — quadratic work on a remote 1.9 MB input.
  // indexOf walks it once: an unterminated block ends the scan instead of
  // restarting it.
  //
  // Dropping the /i is not a behaviour change. tagText() already matches inner
  // tags case-sensitively, so a `<JOB>` block would yield no <title> and be
  // discarded on the next line regardless; the flag only ever bought extra work.
  const OPEN = '<job>';
  const CLOSE = '</job>';
  let cursor = 0;
  for (;;) {
    const start = xml.indexOf(OPEN, cursor);
    if (start === -1) break;
    const from = start + OPEN.length;
    const end = xml.indexOf(CLOSE, from);
    if (end === -1) break; // unterminated final block — nothing further to read
    cursor = end + CLOSE.length;
    const block = xml.slice(from, end);

    const title = decodeEntities(tagText(block, 'title'));
    if (!title) continue;

    // Try detail-url first, then apply-url. Each candidate is VALIDATED before
    // the next is considered: picking the string with `||` and validating once
    // means a present-but-malformed detail-url discards the posting even when a
    // perfectly good apply-url sits beside it.
    let url = '';
    for (const candidate of [tagText(block, 'detail-url'), tagText(block, 'apply-url')]) {
      if (!candidate) continue;
      try {
        const p = new URL(decodeEntities(candidate));
        if (p.protocol === 'http:') p.protocol = 'https:';
        if (p.protocol === 'https:') { url = p.href; break; }
      } catch {
        // malformed — fall through to the next candidate
      }
    }
    if (!url) continue;

    const location = decodeEntities(tagText(block, 'location'));

    /** @type {import('./_types.js').Job & {postedAt?: number}} */
    const job = { title, url, company: companyName, location };
    const postedAt = toEpochMs(tagText(block, 'date'));
    if (postedAt !== undefined) job.postedAt = postedAt;

    out.push(job);
  }
  return out;
}
