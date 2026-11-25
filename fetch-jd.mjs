#!/usr/bin/env node
/**
 * fetch-jd.mjs — read a job description from its ATS's public API instead of
 * the rendered page (#2582).
 *
 * A headless caller that wants a JD today has one option: fetch the posting
 * page and strip HTML. That is 10-30k tokens of nav and markup on a
 * server-rendered board, and on a JS-rendered one (Ashby, Greenhouse's
 * embedded boards) it returns an unrendered shell — correctly detected as thin
 * and discarded — so the caller falls through to WebFetch, which hits the same
 * shell and fails the same way. Meanwhile the ATS's own public JSON endpoint,
 * the one liveness checks already use, ships the full JD body for free.
 *
 *   node fetch-jd.mjs <url>
 *
 * JD text on stdout, exit 0, when a known ATS answers with real content.
 * Exit 3 with `CLOSED_POSTING <evidence>` on stdout when the page itself says the
 * posting is closed: a JobPosting past its validThrough date, closure text
 * in the visible page, or a page that answers HTTP 404 or 410.
 * Exit 2 with empty stdout when the page could not be reached at all (a transport
 * failure worth retrying). Exit 1 with empty stdout and no stderr noise otherwise — a miss is the
 * expected "fall back to the browser path" case, not an error condition, and
 * a visible miss is the whole point: never a fabricated JD.
 *
 * Coverage is JD_TEXT_API_ATS (liveness-api.mjs), including company careers
 * pages that carry only a Greenhouse `?gh_jid=`, and canonical/share-link
 * Workable postings (description, requirements and benefits).
 * When no API covers the host, the page's own schema.org JobPosting (JSON-LD)
 * is read next (fetchJdFromPage below, behind the egress guard). Phenom and
 * bespoke career sites render the JD from script data, so their visible HTML is
 * a shell that any text conversion, WebFetch included, reports as empty.
 * Every API fetch runs through fetchJdViaKnownApi() below
 * — the same dispatch its own `jd` mode uses — so this script and the
 * interactive extractor cannot drift on which ATS is API-fetchable.
 */

import { isMainModule } from './lib/is-main-module.mjs';
import { hasFlag } from './lib/cli-flags.mjs';

import { rejectPrivateOrInvalid, validateUrlSecurity } from './liveness-browser.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { asciiLower, fromLdJson, fromEmbeddedDescription, embeddedDescriptionStrings, ldJsonBlocks, wordCount, LATIN1_ENTITIES } from './lib/jd-parse.mjs';
import { classifyLiveness, cloudflareInterstitial } from './liveness-core.mjs';
import { resolveAtsApi, JD_TEXT_API_ATS } from './liveness-api.mjs';
import { resolveHimalayasPosting, retrieveHimalayasPosting } from './himalayas-posting.mjs';
import { fetchJson } from './providers/_http.mjs';
import { decodeEntities as decodeHtmlEntities } from './providers/_html-entities.mjs';
import { HTML_TAG_RE, stripHtmlComments } from './providers/_html-to-text.mjs';
import { isWorkModelOnly } from './providers/greenhouse.mjs';
import { buildLocation } from './providers/hirehive.mjs';
import { isZohoRecordClosed, parseZohoDetailPage } from './providers/zoho-recruit.mjs';
import { extractCandidateOpportunityDetail, extractLocations } from './providers/ultipro.mjs';
// Imported for its side effect: it installs the connect-time dns.lookup guard
// that providerFetchContext switches on. _http.mjs gets it the same way.
import { dnsLookupPatched } from './providers/_dns-cache.mjs';
import { providerFetchContext } from './providers/_ip-guard.mjs';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
// Below this many words the "JD" is a stub, not a posting.
export const MIN_PAGE_JD_WORDS = 80;

/** LinkedIn hosts, which this module never requests. */
export function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET one HTML document, following redirects by hand so each hop is guarded.
 * Null on any failure: the caller falls through to its next source.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{html: string, finalUrl: string}|{gone: number, finalUrl: string}|null>}
 */
async function fetchHtml(url, timeoutMs) {
  // The connect-time guard lives in the patched dns.lookup. With the patch opted
  // out (CAREER_OPS_NO_DNS_CACHE=1) a name could pass the pre-check and resolve
  // to a private address at connect time, so fail closed: a miss sends the
  // worker back to WebFetch.
  if (!dnsLookupPatched()) return null;
  // NODE_USE_ENV_PROXY=1 makes Node's own fetch go through HTTP(S)_PROXY, where
  // the address check above no longer sees the destination. Providers only use a
  // proxy when CAREER_OPS_TRUST_PROXY_EGRESS=1 says it blocks private addresses;
  // hold this fetch to the same rule and miss otherwise.
  if (/^(1|true)$/i.test(process.env.NODE_USE_ENV_PROXY ?? '') && process.env.CAREER_OPS_TRUST_PROXY_EGRESS !== '1') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let transportFailed = false;
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (rejectPrivateOrInvalid(current)) return null;
      if (isLinkedInHost(new URL(current).hostname)) return null;
      await validateUrlSecurity(current);
      const targetHost = new URL(current).hostname.replace(/^\[|\]$/g, '');
      // The whole hop, body read included, runs inside the provider-fetch
      // context: the socket's DNS lookup happens inside fetch(), after its
      // synchronous part returns, and the context has to still be entered then.
      const outcome = await providerFetchContext.run({ url: current, targetHost }, async () => {
        let res;
        try {
          res = await fetch(current, {
            headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': DEFAULT_USER_AGENT },
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (err) {
          // No HTTP response at all (DNS, refused, timeout, TLS): the caller can retry
          // this. The address guard refusing a private address is a verdict on the
          // destination, not a transport problem, so a retry would change nothing.
          if ((err?.cause?.code ?? err?.code) !== 'ECAREEROPS_BLOCKED_ADDRESS') transportFailed = true;
          throw err;
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          await res.body?.cancel().catch(() => {});
          return location ? { redirect: new URL(location, current).href } : null;
        }
        // 404/410 is the server saying the posting is gone, the same answer
        // classifyLiveness reads as expired. Any other error status may be a
        // block or an outage, so it stays a miss.
        if (res.status === 404 || res.status === 410) { await res.body?.cancel().catch(() => {}); return { gone: res.status, finalUrl: current }; }
        if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
        const type = res.headers.get('content-type') || '';
        if (type && !/html|xml/i.test(type)) { await res.body?.cancel().catch(() => {}); return null; }
        const html = await readCapped(res, MAX_BODY_BYTES);
        return html == null ? null : { html, finalUrl: current };
      });
      if (!outcome) return null;
      if (outcome.redirect) { current = outcome.redirect; continue; }
      return outcome;
    }
    return null;
  } catch {
    return transportFailed ? { unreachable: true } : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every schema.org JobPosting node in the page's JSON-LD blocks. A malformed
 * block is skipped, and a block may be an array or an @graph wrapper.
 *
 * @param {string} html
 * @returns {object[]}
 */
function jobPostingNodes(html) {
  const found = [];
  for (const block of ldJsonBlocks(html)) {
    let parsed;
    try { parsed = JSON.parse(block.trim()); } catch { continue; }
    const queue = [parsed];
    for (let qi = 0; qi < queue.length; qi += 1) {
      const node = queue[qi];
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const child of node) queue.push(child); continue; }
      if (Array.isArray(node['@graph'])) for (const child of node['@graph']) queue.push(child);
      const type = node['@type'];
      if (Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting') found.push(node);
    }
  }
  return found;
}

/** Is a posting's `validThrough` in the past? An absent or unparseable date is not evidence. */
function isPastValidThrough(node, now) {
  const raw = node?.validThrough;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  let when = Date.parse(raw);
  // A date-only value parses as UTC midnight, but means "through that day".
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) when += 24 * 60 * 60 * 1000;
  return Number.isFinite(when) && when < now;
}

/** Distinct large description-like strings in a hydration payload (see fromEmbeddedDescription). */
function embeddedDescriptionCount(html) {
  const seen = new Set();
  for (const raw of embeddedDescriptionStrings(html, { lenient: true })) {
    if (wordCount(String(raw).replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? ' ' : tag))) >= MIN_PAGE_JD_WORDS) seen.add(String(raw).replace(/\s+/g, ' ').trim());
  }
  return seen.size;
}

/**
 * Pick the JD out of already-downloaded page HTML. Pure — exported for tests.
 * Null when the page holds no single posting of at least MIN_PAGE_JD_WORDS
 * words. A posting past its `validThrough` date returns `{closed: true,
 * evidence}` instead, so the caller can pass the closure on rather than
 * letting a fallback fetch score a posting the page itself calls closed.
 *
 * @param {string} html
 * @param {number} [now] epoch ms, injectable for tests
 * @returns {{text: string, method: string, closed?: boolean, evidence?: string}|null}
 */
export function jdFromPageHtml(html, now = Date.now()) {
  return inspectPage(html, now).found;
}

/**
 * Like jdFromPageHtml, but says when the page is ambiguous (several postings or several
 * description-sized payloads): nothing on such a page, closure included, belongs to one URL.
 * @returns {{found: object|null, ambiguous: boolean}}
 */
const collapseWs = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);

/** Stable form of a JSON value: object keys sorted at every depth, strings whitespace-collapsed. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return collapseWs(v);
}

// Tokens that identify a job in a posting URL: path segments containing a digit, and id-like query values.
function jobIdTokens(u) {
  try {
    const x = new URL(u);
    // SPA routes carry the job id in the fragment (/careers#/job/2), so read it like the path.
    const toks = `${x.pathname}/${x.hash.replace(/^#/, '').split('?')[0]}`.split('/').filter((seg) => /\d/.test(seg)).map((seg) => seg.toLowerCase());
    // id-like query values, from the real query and from a query inside the fragment (#/job?jobId=1).
    const fragQuery = x.hash.includes('?') ? x.hash.slice(x.hash.indexOf('?') + 1) : '';
    for (const params of [x.searchParams, new URLSearchParams(fragQuery)]) {
      for (const [k, val] of params) if (/(^|_)(id|jid|jobid|job_id|reqid|req)$/i.test(k) && val) toks.push(val.toLowerCase());
    }
    return toks;
  } catch { return []; }
}

// A bare year or version segment (/2024/, /v2/) is shared structure, not a job id.
const STRUCTURAL_TOKEN_RE = /^(?:(?:19|20)\d\d|v\d+(?:\.\d+)*)$/;

/**
 * Does this JobPosting's own URL clearly name a different job than the one requested? Only when both are
 * absolute URLs on the same host, both carry id-like tokens, and the tokens share nothing. Postings with no
 * URL, a different host (CDN or alias), or no identifying tokens are not rejected.
 */
function postingNamesOtherJob(node, requestedUrl) {
  if (!requestedUrl) return false;
  const own = typeof node?.url === 'string' ? node.url : (typeof node?.['@id'] === 'string' ? node['@id'] : '');
  if (!own) return false;
  try {
    const a = new URL(requestedUrl); const b = new URL(own);
    if (a.hostname.replace(/^www\./, '').toLowerCase() !== b.hostname.replace(/^www\./, '').toLowerCase()) return false;
  } catch { return false; }
  let want = jobIdTokens(requestedUrl); let got = jobIdTokens(own);
  // Compare without year/version segments when both sides still have a real id; otherwise the
  // raw tokens are the only identity there is (/job/2031 vs /job/2044 must still differ).
  const wantStrong = want.filter((t) => !STRUCTURAL_TOKEN_RE.test(t));
  const gotStrong = got.filter((t) => !STRUCTURAL_TOKEN_RE.test(t));
  if (wantStrong.length && gotStrong.length) { want = wantStrong; got = gotStrong; }
  if (!want.length || !got.length) return false;
  return !want.some((t) => got.includes(t));
}

export function inspectPage(html, now = Date.now(), requestedUrl = '') {
  const postings = jobPostingNodes(html);
  // A page that names more than one posting is a listing, or a page whose other
  // postings we cannot tell apart from the requested one. Nothing on it can be
  // attributed to this URL: not a JD, and not a closure either. Postings are
  // told apart by title, description, url, @id, identifier, employer and location, and an identical
  // duplicate representation of one posting does not count twice.
  const distinctLd = new Set(postings.map((node) => JSON.stringify(canon([node.title ?? '', node.description ?? '', node.url ?? '', node['@id'] ?? '', node.identifier ?? '', node.hiringOrganization ?? '', node.jobLocation ?? ''])))).size;
  if (distinctLd > 1) return { found: null, ambiguous: true };
  // A single posting that names a different job than the requested URL is that other job's, not ours.
  if (postings.length && postingNamesOtherJob(postings[0], requestedUrl)) return { found: null, ambiguous: true };

  // Closed per the page's own structured data: not a JD to score. A miss hands
  // the URL back to the worker's WebFetch path and the mode's closed-posting rule.
  const expired = postings.find((node) => isPastValidThrough(node, now));
  if (expired) return { found: { closed: true, evidence: `JobPosting validThrough ${String(expired.validThrough).slice(0, 40)}`, text: '', method: 'ld-json-expired' }, ambiguous: false };

  let ld = null;
  try { ld = fromLdJson(html); } catch { /* malformed JSON-LD fields: ignore, the ambiguity and closure checks still run */ }
  if (ld && wordCount(ld.text) >= MIN_PAGE_JD_WORDS) {
    const rawTitle = postings[0]?.title;
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 300) : '';
    return { found: { ...ld, title }, ambiguous: false };
  }

  // The embedded-payload fallback picks the LONGEST description on the page. It
  // is only trusted when the page holds one description-sized string (and, above,
  // at most one posting), so what it returns can only be this posting's.
  if (embeddedDescriptionCount(html) > 1) return { found: null, ambiguous: true };
  const embedded = fromEmbeddedDescription(html);
  return { found: embedded && wordCount(embedded.text) >= MIN_PAGE_JD_WORDS ? embedded : null, ambiguous: false };
}

/** Largest page the already-downloaded closure check will read (a 1-3 MB cap keeps hostile markup cheap). */
const PAGE_HTML_CAP = 3_000_000;

export const TRUNCATION_NOTICE = (cap) =>
  `[Job description truncated here: the posting is longer than ${cap} characters. This text is NOT the complete job description.]`;

/**
 * Cap a JD without splitting a surrogate pair, and say so when it was cut. A
 * silent cut would let a caller score and archive a partial JD as the whole
 * thing, so the notice is part of the text. Pure — exported for tests.
 */
export function capJdText(text, cap) {
  if (text.length <= cap) return text;
  let cut = text.slice(0, cap);
  // A UTF-16 slice can land between the halves of a surrogate pair.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  // Prefer to end on a paragraph boundary when one is near the cap.
  const para = cut.lastIndexOf('\n\n');
  if (para > cap * 0.6) cut = cut.slice(0, para);
  return `${cut.trimEnd()}\n\n${TRUNCATION_NOTICE(cap)}`;
}

// Closure codes classifyLiveness can reach from page text alone. The softer
// codes (listing page, missing apply control) lean on a rendered DOM's apply
// buttons, which a plain download does not have, so they are not trusted here.
const VISIBLE_CLOSURE_CODES = new Set(['expired_url', 'expired_body', 'deadline_passed']);

const SKIP_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);
const VISIBLE_SCAN_CAP = 1_000_000;

/**
 * The text a reader of the page would see: no scripts, styles or markup.
 * One forward pass with indexOf, so hostile input (millions of `<`, `<!--` or
 * unclosed `<script`) costs linear time instead of the quadratic backtracking a
 * lazy regex would.
 */
function visibleText(html) {
  const src = String(html).slice(0, VISIBLE_SCAN_CAP);
  const lower = asciiLower(src);
  const out = [];
  let i = 0;
  let nextGt = -2;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    out.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      out.push(' ');
      continue;
    }
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24));
    // Cache the next '>' so a run of '<' with no '>' after it costs one scan, not one per '<'.
    if (nextGt !== -1 && nextGt <= lt) nextGt = src.indexOf('>', lt + 1);
    const gt = nextGt;
    if (!m || gt === -1) { out.push(' '); i = lt + 1; continue; }
    if (!m[1] && SKIP_ELEMENTS.has(m[2])) {
      const close = lower.indexOf(`</${m[2]}`, gt + 1);
      const closeEnd = close === -1 ? -1 : src.indexOf('>', close);
      i = closeEnd === -1 ? src.length : closeEnd + 1;
      out.push(' ');
      continue;
    }
    out.push(/^(br|p|div|li|h[1-6]|tr|section|article|ul|ol|table|header|footer|main)$/.test(m[2]) ? '\n' : ' ');
    i = gt + 1;
  }
  return decodeEntities(out.join('')).replace(/[ \t]+/g, ' ');
}

const NAMED_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014' };

/** Decode numeric and the common named character references; unknown ones stay as written. */
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (m, dec, hex, name) => {
    if (name) { if (Object.hasOwn(LATIN1_ENTITIES, name)) return LATIN1_ENTITIES[name]; const k = name.toLowerCase(); return Object.hasOwn(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : m; }
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

/**
 * Did the fetch land on the page that was asked for? A job URL that redirects to
 * a listing or another job would otherwise lend that page's one JobPosting (or
 * its closure) to the requested job. Host `www.` and a trailing slash are not a
 * different page; tracking parameters are ignored.
 */
export function sameDocument(requested, final) {
  try {
    const norm = (u) => {
      const x = new URL(u);
      const q = [...x.searchParams].filter(([k]) => !/^(utm_|gclid$|fbclid$)/i.test(k)).map(([k, v]) => `${k}=${v}`).sort().join('&');
      return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '').toLowerCase()}?${q}`;
    };
    return norm(requested) === norm(final);
  } catch { return false; }
}

// A script-toggled expiry view that is always present in the static markup (Phenom).
const EXPIRE_TEMPLATE_RE = /\b(?:job-expire-view|expire-job-view|job-expire-block)\b/i;

/** The markup with script/style elements and comments removed (linear, indexOf-based). */
function withoutScripts(html) {
  const src = String(html).slice(0, VISIBLE_SCAN_CAP);
  const lower = asciiLower(src);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    out.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const m = /^<(script|style)\b/.exec(lower.slice(lt, lt + 10));
    if (m) {
      const close = lower.indexOf(`</${m[1]}`, lt + 1);
      const closeEnd = close === -1 ? -1 : src.indexOf('>', close);
      i = closeEnd === -1 ? src.length : closeEnd + 1;
      continue;
    }
    out.push('<');
    i = lt + 1;
  }
  return out.join('');
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Remove every element whose opening tag carries the expiry-view marker. One forward pass: the next
 * '>' is cached, tags are length-capped before the marker test, and nesting is a counter, so hostile
 * markup (a run of '<a', deep nesting) costs time linear in the page, never quadratic.
 */
function withoutExpiryViews(html) {
  const src = String(html);
  const lower = asciiLower(src);
  const out = [];
  let i = 0; let nextGt = -2; let skipName = ''; let depth = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { if (!skipName) out.push(src.slice(i)); break; }
    if (!skipName) out.push(src.slice(i, lt));
    if (nextGt !== -1 && nextGt <= lt) nextGt = src.indexOf('>', lt + 1);
    const gt = nextGt;
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24));
    if (!m || gt === -1) { if (!skipName) out.push('<'); i = lt + 1; continue; }
    if (skipName) {
      if (m[2] === skipName) {
        if (m[1]) { if (--depth === 0) skipName = ''; } else depth++;
      }
      i = gt + 1;
      continue;
    }
    if (!m[1] && EXPIRE_TEMPLATE_RE.test(src.slice(lt, Math.min(gt, lt + 4096)))) {
      out.push(' ');
      // A void element (img, br, ...) or a self-closed tag has no end tag: drop just the tag.
      if (!VOID_ELEMENTS.has(m[2]) && lower[gt - 1] !== '/') { skipName = m[2]; depth = 1; }
    } else out.push(src.slice(lt, gt + 1));
    i = gt + 1;
  }
  return out.join('');
}

/**
 * Does the page's visible text say the posting is closed? JSON-LD often carries
 * no expiry, and a closure banner lives in the visible markup that the JD
 * extraction never reads, so check it with the repo's own classifier.
 *
 * @returns {string|null} evidence, or null when the page does not say so
 */
function visibleClosureEvidence(html, url, finalUrl, now = new Date()) {
  // Phenom career sites (observed on careers.roberthalf.com, every live posting) ship the
  // "the job you are trying to apply for has been filled" view inside the page markup and
  // show or hide it with script. Static HTML cannot say which, so the banner text proves
  // nothing there; only structured data (validThrough, an ATS flag) can still close it.
  // Only a marker in the page's own markup counts: one inside a script, style or comment
  // (a bundle that merely names the class) must not suppress a separate closure banner.
  // The expiry view itself is dropped; any other closure banner on the page still counts.
  const markup = withoutExpiryViews(withoutScripts(html));
  const verdict = classifyLiveness({ status: 200, requestedUrl: url, finalUrl, bodyText: visibleText(markup), now });
  return verdict.result === 'expired' && VISIBLE_CLOSURE_CODES.has(verdict.code)
    ? `page text: ${verdict.reason}`.slice(0, 200)
    : null;
}

/**
 * Closure evidence for a page already downloaded (the batch runner's static fetch): an
 * expired JobPosting validThrough, or closure text in the visible page. Null when the
 * page does not say it is closed.
 * @returns {string|null}
 */
export function pageClosureEvidence(html, url, finalUrl = url) {
  // Same gates as fetchJdFromPage: a redirect to another page is not this posting's closure,
  // an ambiguous page proves nothing, and the HTML is capped so hostile input stays cheap.
  if (finalUrl && !sameDocument(url, finalUrl)) {
    // Off the requested page: its text is not this posting's. Only the URL itself can still
    // say closed (a redirect to an error or "job not found" address).
    const verdict = classifyLiveness({ status: 200, requestedUrl: url, finalUrl, bodyText: '', now: new Date() });
    return verdict.result === 'expired' && verdict.code === 'expired_url' ? `redirect: ${verdict.reason}`.slice(0, 200) : null;
  }
  // A page past the cap cannot be checked whole: a second posting after the prefix could be hidden,
  // so nothing page-derived counts as closure (the URL check above and the ATS API still do).
  if (String(html).length > PAGE_HTML_CAP) return null;
  const capped = String(html);
  const { found, ambiguous } = inspectPage(capped, Date.now(), url);
  if (ambiguous) return null;
  if (found?.closed) return found.evidence;
  return visibleClosureEvidence(capped, url, finalUrl);
}

/**
 * ATS results are capped by compactText, which marks a cut
 * with a bare trailing `…`. Nothing downstream recognises that, so turn it into
 * the same explicit notice a cut page JD carries. Text that was not cut is
 * returned unchanged. Pure — exported for tests.
 *
 * @param {string} text
 * @param {number} cap the cap the text was compacted to
 */
export function markCappedAtsText(text, cap) {
  if (text.length !== cap + 1 || !text.endsWith('\u2026')) return text;
  return `${text.slice(0, -1).trimEnd()}\n\n${TRUNCATION_NOTICE(cap)}`;
}

/**
 * The one place a fetched page becomes a JD. Takes what a fetch returned
 * (fetchHtml's result, or a page the batch runner downloaded with curl) and
 * returns the JD, or null when the page holds no JD that can be attributed to
 * this URL. Whether the posting is still open is not decided here; that is
 * fetchedPageClosure's job, asked first by the caller.
 *
 * Attribution: a page that landed on another document, names several postings,
 * or is too large to inspect whole yields nothing. Then structured data (JSON-LD,
 * an embedded payload), then, only when the caller asks for it, the visible text.
 *
 * `visibleText` is opt-in because text with no structured data cannot prove it
 * belongs to one posting. The networked reader keeps its contract ("never the
 * longest description on a listing"); the batch runner, which has always handed
 * its worker that text, asks for it.
 *
 * @param {{html?: string, finalUrl?: string}} page what the fetch returned
 * @param {string} url the URL that was requested
 * @param {{textCap?: number, minWords?: number, visibleText?: boolean}} [opts]
 * @returns {{url: string, title: string, text: string, method: string}|null}
 */
export function extractJd(page, url, { textCap = 20_000, minWords = MIN_PAGE_JD_WORDS, visibleText: allowVisibleText = false } = {}) {
  const html = String(page?.html ?? '');
  if (!html || html.length > PAGE_HTML_CAP || !sameDocument(url, page?.finalUrl || url)) return null;
  const { found, ambiguous } = inspectPage(html, Date.now(), url);
  if (ambiguous || found?.closed) return null;
  if (found) return { url, title: found.title ?? '', text: capJdText(found.text, textCap), method: found.method };
  if (!allowVisibleText) return null;
  const text = visibleText(withoutExpiryViews(withoutScripts(html))).replace(/\s+/g, ' ').trim();
  return wordCount(text) >= minWords ? { url, title: '', text: capJdText(text, textCap), method: 'visible-text' } : null;
}

/**
 * Closure evidence for a fetched page: an HTTP 404/410 on the requested page, or
 * what pageClosureEvidence finds in the page and its final URL. Null when the
 * fetch does not say the posting is closed. A 404 reached through a redirect is
 * the other page's, not this posting's.
 *
 * @param {{html?: string, finalUrl?: string, gone?: number}} page
 * @param {string} url
 * @returns {string|null}
 */
export function fetchedPageClosure(page, url) {
  const finalUrl = page?.finalUrl || url;
  if (page?.gone && sameDocument(url, finalUrl)) return `HTTP ${page.gone}`;
  return pageClosureEvidence(String(page?.html ?? ''), url, finalUrl);
}

/**
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, method: string, closed?: boolean, evidence?: string, unreachable?: boolean}|null>}
 */
export async function fetchJdFromPage(url, textCap = 20_000, timeoutMs = 15_000, { visibleText = false } = {}) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (isLinkedInHost(host)) return null;
  const page = await fetchHtml(url, timeoutMs);
  if (!page) return null;
  if (page.unreachable) return { url, title: '', text: '', method: 'unreachable', unreachable: true };
  const closure = fetchedPageClosure(page, url);
  if (closure) return { url, title: '', text: '', method: page.gone ? 'http-gone' : 'page-closure', closed: true, evidence: closure };
  return extractJd(page, url, { textCap, visibleText });
}

export const JD_TEXT_CAP = 12_000;     // the API tiers' default cap; fetch-jd's own CLI asks for more
export const WORKDAY_TIMEOUT_MS = 10_000;

// Collapse runs of whitespace and cap length so the JD text stays compact.
export function compactText(s, cap = JD_TEXT_CAP) {
  const text = String(s ?? '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Map a `*.myworkdayjobs.com` posting URL to its public per-job CXS endpoint,
 * or null for any other URL.
 *
 * Derivation (tenant/shard/site/jobPath -> `/wday/cxs/{tenant}/{site}/job/{path}`)
 * is delegated to liveness-api.mjs's Workday provider so there is exactly one
 * copy of it, including its SSRF guard: every path segment taken from the input
 * URL is charset-validated and ".." -rejected before it reaches the fixed
 * `{tenant}.{shard}.myworkdayjobs.com` host template.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function workdayCxsUrl(rawUrl) {
  const ats = resolveAtsApi(rawUrl);
  return ats && ats.ats === 'workday' ? ats.apiUrl : null;
}

// Tags whose CLOSE ends a block, so it becomes a line break. `li` is absent on
// purpose: its OPEN tag already emits the break plus a bullet below, and
// breaking on both ends double-spaces every list.
const BLOCK_END_RE = /<\/(p|div|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi;

/**
 * Description markup -> plain text, keeping block structure as newlines. Pure —
 * exported for tests.
 *
 * Not providers/_html-to-text.mjs's htmlToText: that one is tuned for scan
 * payloads and hard-caps at 4000 chars while collapsing ALL whitespace
 * (newlines included) into single spaces. A JD read for evaluation wants the
 * full body up to `--max-chars`, with its paragraph and bullet breaks intact.
 * The entity decoder and the tag matcher ARE shared, so the two cannot drift on
 * the thing that has actually drifted historically (#1555/#1639/#2623).
 *
 * Double-decode for the same reason htmlToText does: payloads often carry
 * entity-escaped markup (`&lt;p&gt;`), and text-level entities only become
 * decodable once the real tags are stripped.
 *
 * @param {unknown} html
 * @returns {string}
 */
export function jdHtmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  const stripped = stripHtmlComments(decodeHtmlEntities(html))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(BLOCK_END_RE, '\n')
    .replace(HTML_TAG_RE, ' ');
  return decodeHtmlEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Shape a jd-mode result from a Workday CXS job payload, into the SAME
 * `{ url, title, text }` contract as the scraped path so no caller has to know
 * which route produced it. Pure — exported for tests.
 *
 * Returns null when the payload isn't a job (`jobPostingInfo` missing) or
 * carries no description, so the caller can fall through to the browser rather
 * than emit a confidently empty JD.
 *
 * `url` is the POSTING url the user passed, not the CXS endpoint: it is what
 * ends up in reports and the tracker.
 *
 * The metadata header is prepended to `text` because each of those fields is
 * evaluation signal the rendered page shows and the description alone does not
 * — location for the location filter, `jobReqId` for the tracker's same-title
 * disambiguation rule, and `canApply: false` as a liveness signal on a posting
 * still served but no longer accepting applications.
 *
 * @param {any} json - parsed CXS response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeWorkdayJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const info = json && typeof json === 'object' ? json.jobPostingInfo : null;
  if (!info || typeof info !== 'object') return null;

  const body = jdHtmlToText(info.jobDescription);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const locations = [
    str(info.location),
    ...(Array.isArray(info.additionalLocations) ? info.additionalLocations.map(str) : []),
  ].filter(Boolean);

  const meta = [];
  if (locations.length) meta.push(`Location: ${locations.join(' | ')}`);
  if (str(info.timeType)) meta.push(`Job type: ${str(info.timeType)}`);
  if (str(info.postedOn)) meta.push(`Posted: ${str(info.postedOn)}`);
  if (str(info.jobReqId)) meta.push(`Req ID: ${str(info.jobReqId)}`);
  if (info.canApply === false) meta.push('Applications closed (canApply: false)');

  return {
    url: postingUrl,
    title: compactText(str(info.title), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Read the body of a response no fetcher will use, dropping each chunk as it
 * arrives, and return null. Left unread, a body still arriving keeps its
 * socket open, and with it the process: fetch-jd.mjs exits once nothing is
 * left to run. Fetchers await this inside their try, so the read stays under
 * their abort timer and a body that never ends stops at the same timeout as
 * the rest of the request. Reading, not cancelling: these error bodies are
 * small, while a cancel aborts the request mid-body and undici then opens a
 * new connection that the process waits for (0.1 to 2.5 s on real Greenhouse
 * and Workday misses, Node 24).
 *
 * @param {Response} res
 */
async function discard(res) {
  try {
    const reader = res.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drop the chunk */ }
  } catch { /* cut off by the abort timer, or unreadable */ }
  return null;
}

/**
 * Fetch + shape one Workday posting from its CXS endpoint. Returns null for
 * ANY inconclusive outcome (blocked host, redirect, non-200, unparseable or
 * unexpected body, timeout) so the caller falls through to the browser path —
 * where a removed posting still yields the real "this job is no longer
 * available" page rather than a hard error.
 *
 * @param {string} apiUrl
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchWorkdayJd(apiUrl, postingUrl, textCap, timeoutMs) {
  // Same host as the already-guarded input, but the guard is cheap and this is
  // the request that actually leaves the process.
  if (rejectPrivateOrInvalid(apiUrl)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, WORKDAY_TIMEOUT_MS));
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error', // a redirect off the derived host is not one to follow
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    return normalizeWorkdayJob(await res.json(), postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one Ashby board entry into a jd-mode result. Pure, so the field
 * mapping is unit-testable without a network round trip.
 *
 * Ashby's public API is ORG-level (the whole board), not per-job, so the job
 * is selected here by a case-insensitive `id` compare — mirroring
 * classifyAshbyBoard's match logic without importing it, since that function
 * returns a liveness verdict, not a job record.
 *
 * `descriptionPlain` is already plain text, so it needs no jdHtmlToText pass.
 * The metadata header carries what the rendered page shows and the description
 * does not, same rationale as normalizeWorkdayJob.
 *
 * @param {any} json - parsed board response body
 * @param {string} jobId - the {jobId} path segment from the posting URL
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeAshbyJob(json, jobId, postingUrl, textCap = JD_TEXT_CAP) {
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const target = String(jobId ?? '').toLowerCase();
  const job = jobs.find((j) => typeof j?.id === 'string' && j.id.toLowerCase() === target);
  if (!job) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const body = str(job.descriptionPlain);
  if (!body) return null;

  const meta = [];
  if (str(job.location)) meta.push(`Location: ${str(job.location)}`);
  if (Array.isArray(job.secondaryLocations)) {
    const extra = job.secondaryLocations.map((l) => str(l?.location)).filter(Boolean);
    if (extra.length) meta.push(`Additional locations: ${extra.join(' | ')}`);
  }
  if (str(job.employmentType)) meta.push(`Type: ${str(job.employmentType)}`);
  // Remote work model, same precedence providers/ashby.mjs:160 settled on:
  // `workplaceType` wins whenever present and `isRemote` is only the fallback.
  // The two disagree constantly — 52 of 60 sampled ramp postings carry
  // `isRemote: true` beside `workplaceType: "Hybrid"` — so trusting isRemote
  // alone labels office-anchored roles Remote. The fallback still earns its
  // place: `workplaceType` is absent on 41 of 60 sampled openai postings.
  const workplaceType = str(job.workplaceType);
  if (workplaceType) meta.push(`Work model: ${workplaceType}`);
  else if (job.isRemote === true) meta.push('Work model: Remote');
  if (job.isListed === false) meta.push('Not currently listed (isListed: false)');

  return {
    url: postingUrl,
    title: compactText(str(job.title), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
    // isListed:false is NOT closure: Ashby serves an unlisted posting by direct
    // link and it can still take applications. The note in the text is the only
    // carrier; closure needs independent evidence.
  };
}

/**
 * Fetch + shape one Ashby posting from its org's job-board API. Returns null
 * for ANY inconclusive outcome (blocked host, non-200, unparseable body, job
 * not found on the board, timeout) so the caller falls through to the browser
 * path, same contract as fetchWorkdayJd.
 *
 * Ashby's public API is ORG-level (the whole board), not per-job — this fetches
 * the board once and picks out `jobId`, mirroring classifyAshbyBoard's match
 * logic (case-insensitive `id` compare) without importing it, since that
 * function returns a liveness verdict, not a job record.
 *
 * @param {string} apiUrl - the org board URL (`resolveAtsApi(url).apiUrl`)
 * @param {string} jobId - the {jobId} path segment from the original URL
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchAshbyJd(apiUrl, jobId, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    const json = await res.json();
    return normalizeAshbyJob(json, jobId, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one Greenhouse per-job payload into a jd-mode result. Pure, same
 * contract as normalizeWorkdayJob/normalizeAshbyJob.
 *
 * `content` is HTML (and HTML-escaped at that), so it goes through
 * jdHtmlToText exactly like Workday's `jobDescription`. `requisition_id` is
 * carried for the tracker's same-title disambiguation rule.
 *
 * `location.name` is the PRIMARY location field and `offices[]` is enrichment
 * — the same precedence providers/greenhouse.mjs:196 applies, reusing its
 * exported isWorkModelOnly so the two cannot drift. Some boards put the work
 * model ("Hybrid", "Distributed") in `location.name` and keep the actual city
 * only in `offices[]`; for exactly those the two are joined, and everywhere
 * else `location.name` stands alone rather than being shadowed by a
 * near-duplicate office entry (a live figma posting carries
 * `location.name: "Berlin, Germany"` beside `offices[0].name: "Berlin, DE "`).
 * Reading `offices[]` alone — as this did before — dropped the `Location:`
 * line entirely for any job whose offices array is empty, which is 7 of 20
 * sampled gitlab postings.
 *
 * The provider pays a separate /offices request for this because the boards
 * LIST endpoint omits offices; the per-job endpoint here returns them inline,
 * so the enrichment is free and can also serve as the fallback when a board
 * ships no `location.name` at all.
 *
 * @param {any} json - parsed boards-api response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeGreenhouseJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const body = jdHtmlToText(json?.content);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const meta = [];
  const offices = Array.isArray(json?.offices) ? json.offices.map((o) => str(o?.name)).filter(Boolean) : [];
  let location = str(json?.location?.name);
  if (offices.length && (!location || isWorkModelOnly(location))) {
    location = [location, ...offices].filter(Boolean).join(' · ');
  }
  if (location) meta.push(`Location: ${location}`);
  if (str(json?.requisition_id)) meta.push(`Req ID: ${str(json.requisition_id)}`);

  return {
    url: postingUrl,
    title: compactText(str(json?.title), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Fetch + shape one Greenhouse posting from its per-job boards-api endpoint.
 * Same failure contract as fetchWorkdayJd/fetchAshbyJd.
 *
 * `content=true` is required — without it the endpoint omits the JD body
 * entirely (same query param providers/greenhouse.mjs uses for its list scan).
 * `content` comes back as HTML, so it goes through jdHtmlToText like Workday's
 * `jobDescription`.
 *
 * @param {string} apiUrl - `resolveAtsApi(url).apiUrl` (no query string)
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchGreenhouseJd(apiUrl, postingUrl, textCap, timeoutMs) {
  const withContent = `${apiUrl}?content=true`;
  if (rejectPrivateOrInvalid(withContent)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withContent, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    const json = await res.json();
    return normalizeGreenhouseJob(json, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one Lever posting into a jd-mode result. Pure, same contract as the
 * other normalizers.
 *
 * `descriptionPlain` is already plain text but is only the first slice of the
 * JD. `lists` carries the labeled sections ("Requirements", "Nice to have")
 * as separate HTML blocks, and `additionalPlain` the trailing "Life at …" /
 * benefits / comp copy — both appended in the order the rendered page shows
 * them, or the JD loses its requirements and its comp entirely. The share is
 * not marginal: on a sampled gopuff posting `descriptionPlain` is 760 chars
 * against 938 in `additionalPlain`, and `additionalPlain` is never contained
 * in `descriptionPlain` (checked over 10 postings on two boards). Do NOT also
 * append `openingPlain` / `descriptionBodyPlain`: `descriptionPlain` already
 * equals their concatenation, so adding them duplicates the description.
 *
 * Order is the contract, since compactText truncates the TAIL — a lowered
 * `--max-chars` has to drop boilerplate, not requirements.
 *
 * There is no closed-state check. The public v0 endpoint 404s a closed posting
 * (liveness-api.mjs:91) and emits no `state` field at all on a live one
 * (verified over 10 postings on two boards), so the fetcher's non-OK guard is
 * the whole of it.
 *
 * @param {any} json - parsed postings-api response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeLeverJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || typeof json !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const lists = Array.isArray(json.lists)
    ? json.lists
        .map((l) => {
          const heading = str(l?.text);
          const content = jdHtmlToText(l?.content);
          return content ? `${heading ? `${heading}\n` : ''}${content}` : '';
        })
        .filter(Boolean)
        .join('\n\n')
    : '';
  // Lever can leave descriptionPlain empty while description holds the HTML.
  const intro = str(json.descriptionPlain) || jdHtmlToText(json.description);
  const body = [intro, lists, str(json.additionalPlain)].filter(Boolean).join('\n\n');
  if (!body) return null;

  const meta = [];
  if (str(json?.categories?.location)) meta.push(`Location: ${str(json.categories.location)}`);
  if (str(json?.categories?.team)) meta.push(`Team: ${str(json.categories.team)}`);

  return {
    url: postingUrl,
    title: compactText(str(json.text), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Fetch + shape one Lever posting from its per-job postings endpoint. Same
 * failure contract as fetchWorkdayJd/fetchAshbyJd/fetchGreenhouseJd.
 *
 * `descriptionPlain` is already plain text (no HTML stripping needed, unlike
 * Greenhouse/Workday). `lists` carries the JD's labeled sections (e.g.
 * "Requirements", "Nice to have") as separate HTML blocks — appended after
 * the main description the same way the rendered page shows them.
 *
 * @param {string} apiUrl - `resolveAtsApi(url).apiUrl`
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchLeverJd(apiUrl, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    const json = await res.json();
    return normalizeLeverJob(json, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Greenhouse posting reached through a company careers page (`?gh_jid=` only,
 * no board in the URL). The embed redirect names the board — the same
 * `followEmbed` hop liveness uses, which also pins the redirect target to
 * greenhouse.io — and the per-job boards-api endpoint then ships the JD.
 */
async function fetchGreenhouseEmbeddedJd(resolved, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(resolved.apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let jobApiUrl;
  try {
    const res = await fetch(resolved.apiUrl, {
      headers: { 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'manual',
      signal: controller.signal,
    });
    jobApiUrl = await resolved.followEmbed(res, resolved.parts);
    await discard(res); // only its status and Location header are read
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return jobApiUrl ? fetchGreenhouseJd(jobApiUrl, postingUrl, textCap, timeoutMs) : null;
}

/**
 * Shape one SmartRecruiters posting into a jd-mode result. Pure, same contract
 * as the other normalizers. The body is `jobAd.sections`, HTML blocks appended
 * in the order the rendered page shows them; the location object also carries
 * remote/hybrid flags, surfaced because they are often the only work-model
 * signal the posting has.
 *
 * @param {any} json - parsed postings-API response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeSmartRecruitersJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const sections = json?.jobAd?.sections;
  if (!sections || typeof sections !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const blocks = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((key) => {
      const body = jdHtmlToText(sections[key]?.text);
      return body ? [str(sections[key]?.title), body].filter(Boolean).join('\n') : '';
    })
    .filter(Boolean);
  if (!blocks.length) return null;

  const loc = json?.location || {};
  const meta = [];
  const where = str(loc.fullLocation) || [str(loc.city), str(loc.country)].filter(Boolean).join(', ');
  if (where) meta.push(`Location: ${where}`);
  if (loc.remote === true) meta.push('Work model: Remote');
  else if (loc.hybrid === true) meta.push('Work model: Hybrid');
  // A closed posting can still ship its ad. The marker carries `active: false`
  // with the text the way Workday carries `canApply: false`, so the caller
  // reads the closure instead of falling back to a page that hides it.
  if (json?.active === false) meta.push('Applications closed (active: false)');

  return {
    url: postingUrl,
    title: compactText(str(json?.name), 300),
    text: compactText([meta.join('\n'), ...blocks].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchSmartRecruitersJd(apiUrl, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    const json = await res.json();
    return normalizeSmartRecruitersJob(json, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one Zoho Recruit posting page into a jd-mode result. Pure, same
 * contract as the other normalizers. The page embeds the posting record
 * (providers/zoho-recruit.mjs parseZohoDetailPage); its `Job_Description` is
 * HTML. The record must be THIS posting's: a page carrying another id, or no
 * record (a removed posting), returns null so the caller falls through.
 *
 * @param {any} html - the posting page's body
 * @param {string} id - the {id} path segment from the posting URL
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeZohoJob(html, id, postingUrl, textCap = JD_TEXT_CAP) {
  const record = parseZohoDetailPage(html);
  if (!record || String(record.id) !== String(id)) return null;
  const body = jdHtmlToText(record.Job_Description);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const meta = [];
  const location = [str(record.City), str(record.State), str(record.Country)].filter(Boolean).join(', ');
  if (location) meta.push(`Location: ${location}`);
  if (record.Remote_Job === true) meta.push('Work model: Remote');
  if (str(record.Job_Type)) meta.push(`Job type: ${str(record.Job_Type)}`);
  if (str(record.Salary)) meta.push(`Salary: ${str(record.Salary)}`);
  if (str(record.Date_Opened)) meta.push(`Posted: ${str(record.Date_Opened)}`);
  if (isZohoRecordClosed(record)) meta.push('Applications closed (the career site shows the posting as filled)');

  return {
    url: postingUrl,
    title: compactText(str(record.Posting_Title) || str(record.Job_Opening_Name), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchZohoJd(apiUrl, id, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'text/html', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    return normalizeZohoJob(await res.text(), id, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one HireHive per-posting API answer into a jd-mode result. Pure, same
 * contract as the other normalizers. The body must be THIS posting's: another
 * id returns null so the caller falls through.
 *
 * @param {any} json - parsed `/api/v1|v2/jobs/<id>` response body
 * @param {string} id - `job_<shortid>` (v2) or the posting number (v1)
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeHireHiveJob(json, id, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || String(json.id) !== String(id)) return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const body = jdHtmlToText(json.description?.html) || str(json.description?.text);
  if (!body) return null;
  const meta = [];
  const location = buildLocation(json);
  if (location) meta.push(`Location: ${location}`);
  if (str(json.type?.name)) meta.push(`Job type: ${str(json.type.name)}`);
  const posted = str(json.published_date) || (Number.isFinite(json.publishedDate) ? new Date(json.publishedDate * 1000).toISOString() : '');
  if (posted) meta.push(`Posted: ${posted.slice(0, 10)}`);
  return {
    url: postingUrl,
    title: compactText(str(json.title), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchHireHiveJd(apiUrl, id, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    return normalizeHireHiveJob(await res.json(), id, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// `JobLocationType` as the board labels it. The page maps the number in script
// it loads from elsewhere, so this was read off rendered pages: on 2026-10-29,
// of 103 postings read in a browser, the 41 with 1 showed "On-site", the 6
// with 2 "Remote" and the 8 with 0 "Hybrid"; the 48 without one showed none.
const ULTIPRO_WORK_MODELS = { 0: 'Hybrid', 1: 'On-site', 2: 'Remote' };

// The record's criteria lists, in the order the page's Qualifications section
// shows them, each item worded as the page words it.
const ULTIPRO_CRITERIA = [
  ['SkillCriteria', 'Skill', (c) => [c.SkillName, c.MinimumScaleValueCode && c.MinimumScaleValueCode !== 'NONE' ? c.MinimumScaleValueDescription : '', c.SkillDescription]],
  ['BehaviorCriteria', 'Behavior', (c) => [c.BehaviorName, c.BehaviorDescription]],
  ['MotivationCriteria', 'Motivation', (c) => [c.MotivationName, c.MotivationDescription]],
  ['EducationCriteria', 'Education', (c) => [c.DegreeName && `${c.DegreeName} or better${c.MajorName ? ` in ${c.MajorName}${c.Related ? ' or related field' : ''}` : ''}`]],
  ['WorkExperienceCriteria', 'Experience', (c) => [ultiproYears(c.MinimumRequiredYears, c.MaximumRequiredYears), c.Description]],
  ['LicenseAndCertificationCriteria', 'License or certification', (c) => [c.LicenseAndCertificationName]],
];

// The page reads "8-10 years" for a range and "5 years" for a minimum alone. No
// sampled posting had a maximum alone; "Up to" keeps it from reading as a floor.
function ultiproYears(min, max) {
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max} years`;
  if (Number.isFinite(min)) return `${min} years`;
  return Number.isFinite(max) ? `Up to ${max} years` : '';
}

/**
 * Shape one UltiPro (UKG Pro Recruiting) detail page into a jd-mode result.
 * Pure, same contract as normalizeZohoJob: UKG has no per-posting JSON API
 * either, and the page embeds the posting record (providers/ultipro.mjs
 * extractCandidateOpportunityDetail), whose `Description` is HTML. The record
 * must be THIS posting's: the extractor throws on another id or on a page
 * that changed shape, and finds nothing on the board's empty page (a removed
 * posting). Each of those returns null so the caller falls through.
 *
 * The page shows more than the description: the header facts and a
 * Qualifications section built from the record's criteria lists. Both are kept,
 * so this text holds what a browser read of the page does, without its
 * buttons and the equal-opportunity notice: on 2026-10-29, of 103 postings
 * read both ways, every work model, pay line, travel line and criteria list
 * the page showed was here too. Qualifications go before the description
 * because compactText cuts the tail, and a long description must not push the
 * requirements out.
 *
 * A closed posting keeps its record, so its JD is still returned, with the
 * closure in the header, as normalizeWorkdayJob does for `canApply: false`.
 *
 * @param {any} html - the detail page's body
 * @param {string} id - the posting's opportunityId, lower-cased as the rung requests it
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeUltiproJob(html, id, postingUrl, textCap = JD_TEXT_CAP) {
  let record;
  try {
    const found = extractCandidateOpportunityDetail(html, id);
    if (found.status !== 'ok') return null;
    record = found.detail;
  } catch {
    return null;
  }
  const body = jdHtmlToText(record.Description);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : '');
  const meta = [];
  const location = extractLocations(record.Locations);
  if (location) meta.push(`Location: ${location}`);
  const workModel = ULTIPRO_WORK_MODELS[record.JobLocationType];
  if (workModel) meta.push(`Work model: ${workModel}`);
  if (typeof record.FullTime === 'boolean') meta.push(`Job type: ${record.FullTime ? 'Full time' : 'Part time'}`);
  if (str(record.JobCategoryName)) meta.push(`Job category: ${str(record.JobCategoryName)}`);
  const pay = record.PayRangeVisible === true ? record.PayRange : null;
  if (str(pay?.PayRangeMinimum) && str(pay?.PayRangeMaximum)) {
    meta.push(`Pay range: ${str(pay.PayRangeMinimum)} to ${str(pay.PayRangeMaximum)} ${str(record.PayRangeCurrencyCode)}`.trim());
  }
  const amount = record.CompensationAmount;
  if (str(amount?.Value)) {
    const salaried = record.Salaried === true;
    meta.push(`${salaried ? 'Salary' : 'Pay'}: ${[str(amount.Value), str(amount.Code), salaried ? 'per year' : ''].filter(Boolean).join(' ')}`);
  }
  if (typeof record.TravelRequired === 'boolean') {
    const travel = str(record.TravelDescription);
    meta.push(`Travel required: ${record.TravelRequired ? 'Yes' : 'No'}${travel ? ` (${travel})` : ''}`);
  }
  const posted = str(record.PostedDate).match(/^\d{4}-\d{2}-\d{2}/);
  if (posted) meta.push(`Posted: ${posted[0]}`);
  if (str(record.RequisitionNumber)) meta.push(`Req ID: ${str(record.RequisitionNumber)}`);
  if (record.OpportunityIsClosed === true) meta.push('Applications closed (OpportunityIsClosed: true)');

  const qualifications = [];
  for (const [key, label, words] of ULTIPRO_CRITERIA) {
    const items = Array.isArray(record[key]) ? record[key].filter((c) => c && typeof c === 'object') : [];
    // Required first, then preferred, as the page groups them.
    for (const required of [true, false]) {
      for (const c of items.filter((item) => (item.Required === true) === required)) {
        const text = words(c).map(str).filter(Boolean).join(': ');
        if (text) qualifications.push(`- ${label} (${required ? 'required' : 'preferred'}): ${text}`);
      }
    }
  }

  return {
    url: postingUrl,
    title: compactText(str(record.Title), 300),
    text: compactText([
      meta.join('\n'),
      qualifications.length ? `Qualifications:\n${qualifications.join('\n')}` : '',
      body,
    ].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchUltiproJd(apiUrl, id, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'text/html', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    return normalizeUltiproJob(await res.text(), id, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one HiBob `/api/job-ad/{uuid}/application-form` answer into a jd-mode
 * result. Pure, same contract as the other normalizers. `data.jobAd` carries
 * the title, the site as the page shows it ("Berlin, Germany"), the work model
 * and the employment type; `jobDescription` keys each field by a path ending
 * in `/jobDescription/{field}` and wraps the value as `{ value }`. The four
 * text sections are HTML and keep the tenant's own section labels when it set
 * them.
 *
 * @param {any} json - parsed application-form response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeHibobJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const ad = json?.data?.jobAd;
  if (!ad || typeof ad !== 'object') return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const fields = ad.jobDescription && typeof ad.jobDescription === 'object' ? ad.jobDescription : {};
  const field = (name) => {
    const key = Object.keys(fields).find((k) => k.endsWith(`/jobDescription/${name}`));
    return key ? fields[key]?.value : undefined;
  };
  const labels = field('sectionLabels') && typeof field('sectionLabels') === 'object' ? field('sectionLabels') : {};
  const blocks = [];
  for (const [key, label] of [['description', 'Description'], ['responsibilities', 'Responsibilities'], ['requirements', 'Requirements'], ['benefits', 'Benefits']]) {
    const body = jdHtmlToText(typeof field(key) === 'string' ? field(key) : '');
    if (body) blocks.push(`${str(labels[key]) || label}:\n${body}`);
  }
  if (!blocks.length) return null;

  const meta = [];
  if (str(ad.site)) meta.push(`Location: ${str(ad.site)}`);
  if (str(ad.workspaceType)) meta.push(`Work model: ${str(ad.workspaceType)}`);
  if (str(ad.employmentType)) meta.push(`Type: ${str(ad.employmentType)}`);
  const min = field('payTransparencyMinSalary');
  const max = field('payTransparencyMaxSalary');
  const range = [min, max].filter((v) => typeof v === 'number' && v > 0).map((v) => v.toLocaleString('en-US')).join(' – ');
  if (range) meta.push(`Salary: ${[range, str(field('payTransparencySalaryCurrency')), str(field('payTransparencySalaryPayPeriod'))].filter(Boolean).join(' ')}`);

  return {
    url: postingUrl,
    title: compactText(str(ad.title), 300),
    text: compactText([meta.join('\n'), ...blocks].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchHibobJd(resolved, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(resolved.apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolved.apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT, ...resolved.headers },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await discard(res);
    return normalizeHibobJob(await res.json(), postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Workable full-body JD, independent of liveness state and listing text caps. */
export function normalizeWorkableJob(json, shortcode, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || typeof json !== 'object' || json.shortcode !== shortcode ||
      typeof json.title !== 'string' || !json.title.trim()) return null;
  const title = compactText(jdHtmlToText(json.title), 300);
  if (!title) return null;
  const blocks = [];
  for (const [key, label] of [['description', 'Description'], ['requirements', 'Requirements'], ['benefits', 'Benefits']]) {
    const html = typeof json[key] === 'string' ? json[key] : '';
    // Decode before removing chrome: the API can entity-escape its HTML tags.
    const body = jdHtmlToText(decodeHtmlEntities(html).replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));
    if (/[\p{L}\p{N}]/u.test(body)) blocks.push(`${label}:\n${body}`);
  }
  if (!blocks.length) return null;
  return {
    url: postingUrl,
    title,
    text: compactText(blocks.join('\n\n'), textCap),
  };
}

/** Reuse the resolver's guarded share-link hop; never follow API redirects. */
async function fetchWorkableJd(resolved, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(resolved.apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const options = {
    headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
    redirect: 'error',
    signal: controller.signal,
  };
  // The share link's redirect, of which only the status and Location header
  // are read. Its body is drained last: both requests share one timer, so a
  // slow body read first would spend the posting request's budget.
  let redirect;
  try {
    let apiUrl = resolved.apiUrl;
    if (resolved.followEmbed) {
      redirect = await fetch(apiUrl, { ...options, redirect: 'manual' });
      apiUrl = await resolved.followEmbed(redirect, resolved.parts);
      if (!apiUrl || rejectPrivateOrInvalid(apiUrl)) return null;
    }
    const res = await fetch(apiUrl, options);
    if (!res.ok) return await discard(res);
    return normalizeWorkableJob(await res.json(), resolved.parts.shortcode, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    if (redirect) await discard(redirect);
    clearTimeout(timer);
  }
}

/** JD-only sources leave the liveness resolver and its classifications unchanged. */
export function resolveJdApi(url) {
  const himalayas = resolveHimalayasPosting(url);
  if (himalayas) return { ats: 'himalayas', apiUrl: himalayas.apiUrl };

  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const bambooHost = /^[a-z0-9][a-z0-9-]*\.bamboohr\.com$/.test(parsed.hostname);
  if (bambooHost && parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password) {
    const posting = /^\/careers\/(\d+)\/?$/.exec(parsed.pathname);
    if (posting) {
      const postingPath = parsed.origin + '/careers/' + posting[1];
      return { ats: 'bamboohr', apiUrl: postingPath + '/detail', postingPath };
    }
  }

  return resolveAtsApi(url);
}

async function fetchBambooHrJd(resolved, url, textCap, timeoutMs) {
  try {
    const data = await fetchJson(resolved.apiUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      timeoutMs,
      maxBytes: 1024 * 1024,
    });
    const job = data?.result?.jobOpening;
    if (job?.jobOpeningStatus !== 'Open' || typeof job.jobOpeningShareUrl !== 'string') return null;
    const shareUrl = new URL(job.jobOpeningShareUrl);
    const postingPath = shareUrl.origin + shareUrl.pathname.replace(/\/$/, '');
    if (shareUrl.username || shareUrl.password || postingPath !== resolved.postingPath) return null;
    const text = jdHtmlToText(job.description);
    if (!text) return null;
    return { url, title: compactText(jdHtmlToText(job.jobOpeningName), 300), text: compactText(text, textCap) };
  } catch {
    return null;
  }
}

async function fetchHimalayasJd(_resolved, url, textCap, timeoutMs) {
  const result = await retrieveHimalayasPosting(url, { timeoutMs });
  if (result.publisherStatus !== 'open') return null;
  const text = jdHtmlToText(result.job.description);
  if (!text) return null;
  return { url, title: compactText(result.job.title, 300), text: compactText(text, textCap) };
}


/**
 * ats id → fetcher. THE routing table `fetchJdViaKnownApi` dispatches through,
 * exported so the owned test can assert its key set IS `JD_TEXT_API_ATS`.
 *
 * A `switch` could not carry that guarantee: deleting `case 'lever'` leaves a
 * test that only re-derives ids from `resolveAtsApi` green, because such a
 * test never touches the dispatcher. A map's keys ARE the dispatcher, so the
 * same deletion reddens it.
 *
 * Every entry takes the same `(resolved, url, textCap, timeoutMs)` shape so
 * dispatch stays a lookup; the extra `parts` arguments (Ashby's `jobId`, Zoho
 * Recruit's, UltiPro's and HireHive's `id`) are unpacked inside their own
 * entries rather than widening the shared signature.
 */
export const JD_FETCHERS = {
  bamboohr: fetchBambooHrJd,
  himalayas: fetchHimalayasJd,
  workable: fetchWorkableJd,
  'workable-short': fetchWorkableJd,
  workday: (resolved, url, textCap, timeoutMs) =>
    fetchWorkdayJd(resolved.apiUrl, url, textCap, timeoutMs),
  ashby: (resolved, url, textCap, timeoutMs) =>
    fetchAshbyJd(resolved.apiUrl, resolved.parts.jobId, url, textCap, timeoutMs),
  greenhouse: (resolved, url, textCap, timeoutMs) =>
    fetchGreenhouseJd(resolved.apiUrl, url, textCap, timeoutMs),
  lever: (resolved, url, textCap, timeoutMs) =>
    fetchLeverJd(resolved.apiUrl, url, textCap, timeoutMs),
  'greenhouse-embedded': (resolved, url, textCap, timeoutMs) =>
    fetchGreenhouseEmbeddedJd(resolved, url, textCap, timeoutMs),
  smartrecruiters: (resolved, url, textCap, timeoutMs) =>
    fetchSmartRecruitersJd(resolved.apiUrl, url, textCap, timeoutMs),
  'zoho-recruit': (resolved, url, textCap, timeoutMs) =>
    fetchZohoJd(resolved.apiUrl, resolved.parts.id, url, textCap, timeoutMs),
  ultipro: (resolved, url, textCap, timeoutMs) =>
    fetchUltiproJd(resolved.apiUrl, resolved.parts.id, url, textCap, timeoutMs),
  hirehive: (resolved, url, textCap, timeoutMs) =>
    fetchHireHiveJd(resolved.apiUrl, resolved.parts.id, url, textCap, timeoutMs),
  hibob: fetchHibobJd,
};

/**
 * Try every known JD-text-capable ATS API for one posting URL before anyone
 * reaches for a browser. This is the single dispatch point both this script's
 * own CLI (jd mode) and `fetch-jd.mjs` (the bash-callable front door) call —
 * one copy of the routing table, so the interactive and headless paths cannot
 * drift on which ATS is API-fetchable.
 *
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, ats: string}|null>}
 *   null = not a JD_TEXT_API_ATS host, or the fetch/parse was inconclusive —
 *   caller should fall through to a browser-backed read.
 */
export async function fetchJdViaKnownApi(url, textCap = JD_TEXT_CAP, timeoutMs = WORKDAY_TIMEOUT_MS) {
  const resolved = resolveJdApi(url);
  if (!resolved || !JD_TEXT_API_ATS.has(resolved.ats)) return null;
  const fetcher = JD_FETCHERS[resolved.ats];
  if (!fetcher) return null;

  // `resolveAtsApi` carries a per-ATS timeout for the APIs that need one
  // (Ashby: 20 s, liveness-api.mjs:113); without it a slow Ashby board that
  // liveness waits for falls through here on the generic 15 s both callers
  // pass. Same precedence liveness-api.mjs:357 applies to the same field —
  // the resolved value wins, the argument is the fallback for every ATS that
  // declares none.
  const budgetMs = resolved.timeoutMs || timeoutMs;
  const result = await fetcher(resolved, url, textCap, budgetMs);
  return result ? { ...result, ats: resolved.ats } : null;
}

/**
 * A Cloudflare challenge or block page served in place of the posting, as a
 * jd-mode failure, or null. Pure — exported for tests.
 *
 * jdFailure() never rejects a result above the length floor, and a
 * site-branded challenge body clears it (#6713: 838 characters, "Humans
 * only"), so the interstitial was emitted as the JD. Cloudflare titles the page
 * itself, and archive-posting.mjs refuses the same pages by that title on an
 * HTTP error (#6724). `bot_challenge` is the code liveness gives the same wall.
 *
 * @param {{ status?: number, pageTitle?: string, url?: string }} page
 */
export function challengeFailure({ status = 0, pageTitle = '', url = '' } = {}) {
  if (!(status >= 400)) return null;
  const kind = cloudflareInterstitial(pageTitle);
  if (!kind) return null;
  return { error: `HTTP ${status} Cloudflare ${kind} ("${String(pageTitle).trim()}"), not the posting`, code: 'bot_challenge', url };
}

const TEXT_CAP = 20_000; // a batch report reads the whole JD; no token-budget reason to cap tighter
const TIMEOUT_MS = 15_000;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node fetch-jd.mjs <url> [--visible-text]
  node fetch-jd.mjs --help

Options:
  --visible-text  When the page has no structured JD, use its visible text (at least
                  80 words). Off by default: such text cannot prove it belongs to
                  one posting
  --help, -h      Print this usage block and exit`);
    process.exit(0);
  }

  const url = args[0];

  if (!url) {
    console.error('usage: node fetch-jd.mjs <url>');
    process.exit(1);
  }

  // Tier 1: the ATS's public API. Tier 2: the page's own JSON-LD JobPosting, for
  // template-driven boards no API covers (Phenom, bespoke sites) whose visible
  // HTML carries no JD at all.
  const visibleText = hasFlag(args, '--visible-text');
  const result = (await fetchJdViaKnownApi(url, TEXT_CAP, TIMEOUT_MS))
    ?? (await fetchJdFromPage(url, TEXT_CAP, TIMEOUT_MS, { visibleText }));
  // No stderr, by design: the caller's browser/WebFetch fallback is the
  // intended next step, and warning on every non-covered host would make the
  // normal path look broken.
  // Signal the miss via exitCode, not process.exit(1). On Windows, Node 24
  // aborts when process.exit() runs right after a request (nodejs/node#56645):
  // it prints a libuv assertion and exits with a crash code instead of 1.
  // Measured 2026-11-04 on Node 24.14.1: misses on Greenhouse, Workable,
  // SmartRecruiters and Workday aborted 4 times out of 4. Returning lets the
  // process exit 1 once the event loop drains, right after the answer.
  if (!result) {
    process.exitCode = 1;
    return;
  }

  // No HTTP response at all (DNS, refused, timeout, TLS): a transport problem, not
  // a page that cannot be read, so a caller may retry it. Exit 2, empty stdout.
  if (result.unreachable) {
    process.exitCode = 2;
    return;
  }

  // The posting's own data says it is closed: the page's JobPosting, its visible
  // text, or an ATS API flag such as Ashby's isListed: false. Say so with a
  // distinct exit code instead of a plain miss, so a caller does not fall back
  // to a fetch that could return the JD from the visible page and score it.
  if (result.closed) {
    process.stdout.write(`CLOSED_POSTING ${result.evidence}`);
    process.exitCode = 3;
    return;
  }

  // The structured-page reader already includes the posting title in its text.
  const header = result.title && result.method !== 'ld+json' ? `${result.title}\n\n` : '';
  process.stdout.write(header + markCappedAtsText(result.text, TEXT_CAP));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-jd: unexpected error — ${err?.message || err}`);
    process.exitCode = 1; // not process.exit(1), for the reason given at the miss
  });
}
