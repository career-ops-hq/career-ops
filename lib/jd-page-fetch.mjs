/**
 * jd-page-fetch.mjs — read a JD out of the posting page's own bytes when no ATS
 * API covers the host.
 *
 * Template-driven career sites (Phenom, and most bespoke ones) render the job
 * body from <script> data: the page ships a schema.org JobPosting in
 * `application/ld+json`, and the visible HTML is title, location and Apply
 * chrome. Anything that converts the page to text drops script content, so it
 * sees ~270 characters and reports "partial page shell". WebFetch does exactly
 * that, which is how a live Robert Half posting (7 KB of JD in its JSON-LD) came
 * back from the web app as "Needs review".
 *
 * This is the same recovery the batch runner already does (batch/jd-rescue.mjs):
 * one unauthenticated GET, then offline parsing. The parsers are imported from
 * there, not copied, so the two paths cannot drift on what counts as a JD.
 *
 * The GET is the only network step, so it carries the egress guard every other
 * fetcher has, in three layers:
 *   1. a literal-host check (rejectPrivateOrInvalid) and a DNS pre-check
 *      (validateUrlSecurity) on the URL and on every redirect hop, which are
 *      followed by hand;
 *   2. each hop runs inside providerFetchContext, so the patched dns.lookup
 *      (providers/_dns-cache.mjs) validates the address the socket is actually
 *      dialled on. Layer 1 resolves once and layer 2 resolves again at connect
 *      time, so a name that answers public-then-private (DNS rebinding) is
 *      refused at the connection, not just at the pre-check;
 *   3. a body cap and an HTML content-type check.
 *
 * Four more refusals keep a wrong JD from reaching the evaluate worker, which
 * trusts what it is handed instead of fetching it:
 *   - LinkedIn is never fetched here (AGENTS.md "LinkedIn JD loading guard":
 *     one bounded browser attempt, no automatic extraction retry);
 *   - a posting whose `validThrough` is past is closed, so it is a miss and the
 *     worker's own closed-posting rule decides;
 *   - a page answering HTTP 404 or 410 is closed, as in classifyLiveness;
 *   - a page that holds more than one posting (a listing) is a miss, never the
 *     longest description on it.
 */

import { rejectPrivateOrInvalid, validateUrlSecurity } from '../liveness-browser.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { asciiLower, fromLdJson, fromEmbeddedDescription, embeddedDescriptionStrings, ldJsonBlocks, wordCount, LATIN1_ENTITIES } from './jd-parse.mjs';
import { classifyLiveness } from '../liveness-core.mjs';
// Imported for its side effect: it installs the connect-time dns.lookup guard
// that providerFetchContext switches on. _http.mjs gets it the same way.
import { dnsLookupPatched } from '../providers/_dns-cache.mjs';
import { providerFetchContext } from '../providers/_ip-guard.mjs';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
// Same floor jd-rescue.mjs uses: below it the "JD" is a stub, not a posting.
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
        const res = await fetch(current, {
          headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': DEFAULT_USER_AGENT },
          redirect: 'manual',
          signal: controller.signal,
        });
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
    return null;
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
  const scan = newScan(src);
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
      i = skipElement(src, lower, m[2], lt, gt + 1, scan);
      out.push(' ');
      continue;
    }
    if (!m[1] && isHiddenOpen(lower, lt, gt, m[2])) {
      // An element that never closes (an implied </p>) hides only its own tag, not the rest of the page.
      const end = skipSubtree(src, lower, m[2], lt, gt + 1, scan);
      i = end === -1 ? gt + 1 : end;
      out.push(' ');
      continue;
    }
    out.push(/^(br|p|div|li|h[1-6]|tr|section|article|ul|ol|table|header|footer|main)$/.test(m[2]) ? '\n' : ' ');
    i = gt + 1;
  }
  return decodeEntities(out.join('')).replace(/[ \t]+/g, ' ');
}

// An opening tag longer than this is not tested for hidden attributes, so a run of `<a ` with one
// far-away `>` cannot make the attribute test quadratic.
const MAX_TAG_LEN = 4096;
// SVG and MathML elements, the only ones whose `/>` really self-closes (HTML ignores the slash on
// a non-void element: `<div hidden/>` stays open until `</div>`).
const FOREIGN_ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'defs', 'symbol', 'text', 'tspan', 'image', 'stop', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern', 'filter', 'marker', 'desc', 'foreignobject', 'animate', 'set', 'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mrow', 'msup', 'msub', 'mfrac', 'msqrt', 'mspace']);
const ATTR_RE = /\s([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Does this lowercased opening tag carry a hidden attribute: `hidden` or an inline `display:none`?
 * Attribute names only, so `class="flex hidden"` or `aria-label="no hidden fees"` do not count.
 * `aria-hidden` is not tested: it hides from screen readers, not from sighted readers of the page.
 */
function hasHiddenAttr(tag, name) {
  ATTR_RE.lastIndex = 0;
  const rest = tag.slice(1 + name.length);
  let a;
  while ((a = ATTR_RE.exec(rest))) {
    const value = (a[2] ?? a[3] ?? a[4] ?? '').trim();
    if (a[1] === 'hidden') return true;
    if (a[1] === 'style' && /display\s*:\s*none/.test(value)) return true;
  }
  return false;
}

/** Is the opener at [lt, gt] an element a reader cannot see? */
function isHiddenOpen(lower, lt, gt, name) {
  // A browser ignores the `/` of `<div hidden/>`: the element stays open. Only foreign (SVG,
  // MathML) elements self-close, so the slash counts as an end there alone.
  const selfClosed = lower[gt - 1] === '/' && FOREIGN_ELEMENTS.has(name);
  return !VOID_ELEMENTS.has(name) && !selfClosed && gt - lt < MAX_TAG_LEN && hasHiddenAttr(lower.slice(lt, gt + 1), name);
}

/** Scan state shared by one walk over a page: per-tag-name matching state and a total scan budget. */
function newScan(src) {
  return { names: new Map(), spent: 0, cap: 8 * src.length + 100_000 };
}

/**
 * Index just past the `</name>` that closes the element opened at `open` (its opener ends before
 * `from`), counting same-name nesting; -1 when it never closes. Openers are asked about in page
 * order, so each name keeps one forward cursor with a stack of open elements and the pairs it has
 * resolved: a run of unclosed openers costs one scan to the end of the page, not one scan each,
 * and distinct names scan only as far as their own close. `scan.spent` caps the total work; once
 * it is spent the answer is -1 (the caller then hides only the opening tag).
 */
function skipSubtree(src, lower, name, open, from, scan) {
  let st = scan.names.get(name);
  // Comments and script/style/noscript contents are not markup: a tag inside one never nests or closes.
  if (!st) scan.names.set(name, st = { pos: 0, pairs: new Map(), gt: -2, re: new RegExp(`<!--|<(?:script|style|noscript)(?![a-z0-9])|<(/?)${name}(?![a-z0-9])`, 'g') });
  if (st.pairs.has(open)) return st.pairs.get(open);
  if (open < st.pos || scan.spent > scan.cap) return -1; // scanned past it, no close found
  const stack = [open];
  const re = st.re;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(lower))) {
    if (m[1] === undefined) {
      // A comment or a raw-text element: jump past it (to the end of the page when it never ends).
      const raw = m[0] === '<!--' ? '-->' : `</${m[0].slice(1)}`;
      const at = lower.indexOf(raw, re.lastIndex);
      if (at === -1) { re.lastIndex = src.length; continue; }
      const end = raw === '-->' ? at + 3 : src.indexOf('>', at);
      re.lastIndex = end === -1 ? src.length : (raw === '-->' ? end : end + 1);
      continue;
    }
    if (!m[1]) { stack.push(m.index); continue; }
    const o = stack.pop();
    if (o === undefined) continue;
    if (st.gt !== -1 && st.gt <= m.index) st.gt = src.indexOf('>', m.index);
    const end = st.gt === -1 ? -1 : st.gt + 1;
    st.pairs.set(o, end);
    if (o === open) { st.pos = re.lastIndex; scan.spent += re.lastIndex - from; return end; }
  }
  st.pos = src.length;
  scan.spent += src.length - from;
  return -1;
}

/**
 * Index just past a script/style/noscript/template element. Scripts, styles and noscript end at
 * the first closing tag, as a browser does (a `<script>` inside a script string does not nest);
 * only `template` nests. src.length when it never closes.
 */
function skipElement(src, lower, name, open, from, scan) {
  if (name === 'template') {
    // Scan budget already spent: skip only the opening tag rather than the rest of the page.
    if (scan.spent > scan.cap) return from;
    const end = skipSubtree(src, lower, name, open, from, scan);
    return end === -1 ? src.length : end;
  }
  const close = lower.indexOf(`</${name}`, from);
  const closeEnd = close === -1 ? -1 : src.indexOf('>', close);
  return closeEnd === -1 ? src.length : closeEnd + 1;
}

/**
 * Walk the markup a reader could see: not inside a comment, a script/style/template/noscript
 * element, or a hidden container. Calls `onTag(name, isClose, lt, gt)` for every other tag; an
 * `onTag` return of `true` stops the walk. Linear: the next '>' is cached, so a run of '<' with no
 * '>' costs one scan, not one per '<'.
 */
function walkVisibleTags(src, lower, onTag) {
  const scan = newScan(src);
  let i = 0;
  let nextGt = -2;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) return;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24));
    if (nextGt !== -1 && nextGt <= lt) nextGt = src.indexOf('>', lt + 1);
    const gt = nextGt;
    if (!m || gt === -1) { i = lt + 1; continue; }
    const name = m[2];
    if (!m[1] && SKIP_ELEMENTS.has(name)) { i = skipElement(src, lower, name, lt, gt + 1, scan); continue; }
    if (!m[1] && isHiddenOpen(lower, lt, gt, name)) {
      const end = skipSubtree(src, lower, name, lt, gt + 1, scan);
      i = end === -1 ? gt + 1 : end;
      continue;
    }
    if (onTag(name, Boolean(m[1]), lt, gt)) return;
    i = gt + 1;
  }
}

/**
 * The visible `<tag>` elements of a page, as `{open, close}` offsets (`close` is the start of the
 * matching `</tag`, or -1 when it never closes). A tag, or a closing tag, inside a comment, script,
 * template or hidden container is not counted, so a `</main>` in a script string never ends a region.
 */
function visibleElements(src, lower, tag) {
  const found = [];
  const stack = [];
  walkVisibleTags(src, lower, (name, isClose, lt) => {
    if (name !== tag) return false;
    if (!isClose) { const el = { open: lt, close: -1 }; found.push(el); stack.push(el); return false; }
    const el = stack.pop();
    if (el) el.close = lt;
    return false;
  });
  return found;
}

/**
 * The <main> (else <article>) region of a page when it has exactly one visible one, so nav and
 * footer chrome stay out of a visible-text JD; the whole page otherwise. The doctype is dropped
 * either way. A tag inside a comment, template or hidden container is not counted. `capped` is
 * true when the page was longer than the scan cap, so the caller can say the text is partial.
 */
function mainRegion(html) {
  const full = String(html);
  const capped = full.length > VISIBLE_SCAN_CAP;
  const src = full.slice(0, VISIBLE_SCAN_CAP).replace(/^\s*<!doctype[^>]*>/i, '');
  const lower = asciiLower(src);
  for (const tag of ['main', 'article']) {
    const els = visibleElements(src, lower, tag);
    if (els.length !== 1 || els[0].close === -1) continue;
    return { region: src.slice(els[0].open, els[0].close), capped };
  }
  return { region: src, capped };
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
 * ATS results are capped by browser-extract's compactText, which marks a cut
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
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @param {{visibleFallback?: boolean}} [opts] visibleFallback: when the page carries no structured
 *   JD, return its visible text if it is posting-sized (#7507). Off by default: visible text of an
 *   unknown page can be a listing or a shell, so only a caller that has no other way to read the
 *   page (a worker whose WebFetch is intercepted) asks for it.
 * @returns {Promise<{url: string, title: string, text: string, method: string, closed?: boolean, evidence?: string}|null>}
 */
export async function fetchJdFromPage(url, textCap = 20_000, timeoutMs = 15_000, opts = {}) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (isLinkedInHost(host)) return null;
  const page = await fetchHtml(url, timeoutMs);
  if (!page) return null;
  if (page.finalUrl && !sameDocument(url, page.finalUrl)) return null;
  if (page.gone) return { url, title: '', text: '', method: 'http-gone', closed: true, evidence: `HTTP ${page.gone}` };
  const { found, ambiguous } = inspectPage(page.html, Date.now(), url);
  if (!found) {
    // No extractable JD, but a closure banner is still an answer: exit 3, not a plain miss.
    // Not on an ambiguous page, though: its text may be a listing's, not this posting's.
    const only = ambiguous ? null : visibleClosureEvidence(page.html, url, page.finalUrl);
    if (only) return { url, title: '', text: '', method: 'visible-closure', closed: true, evidence: only };
    if (opts.visibleFallback && !ambiguous) {
      const { region, capped } = mainRegion(page.html);
      const text = visibleText(region).replace(/[ \t]*\n[ \t\n]*/g, '\n').trim();
      if (wordCount(text) >= MIN_PAGE_JD_WORDS) {
        // A page longer than the scan cap is read in part: say so, as the structured path does.
        const body = capJdText(text, textCap);
        const partial = capped && !body.endsWith(TRUNCATION_NOTICE(textCap));
        return { url, title: '', text: partial ? `${body}\n\n${TRUNCATION_NOTICE(VISIBLE_SCAN_CAP)}` : body, method: 'visible-text' };
      }
    }
    return null;
  }
  if (found.closed) return { url, title: '', text: '', method: found.method, closed: true, evidence: found.evidence };
  const visibleClosure = visibleClosureEvidence(page.html, url, page.finalUrl);
  if (visibleClosure) return { url, title: '', text: '', method: 'visible-closure', closed: true, evidence: visibleClosure };
  return { url, title: found.title ?? '', text: capJdText(found.text, textCap), method: found.method };
}
