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
 * Three more refusals keep a wrong JD from reaching the evaluate worker, which
 * trusts what it is handed instead of fetching it:
 *   - LinkedIn is never fetched here (AGENTS.md "LinkedIn JD loading guard":
 *     one bounded browser attempt, no automatic extraction retry);
 *   - a posting whose `validThrough` is past is closed, so it is a miss and the
 *     worker's own closed-posting rule decides;
 *   - a page that holds more than one posting (a listing) is a miss, never the
 *     longest description on it.
 */

import { rejectPrivateOrInvalid, validateUrlSecurity } from '../liveness-browser.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { fromLdJson, fromEmbeddedDescription, wordCount } from '../batch/jd-rescue.mjs';
// Imported for its side effect: it installs the connect-time dns.lookup guard
// that providerFetchContext switches on. _http.mjs gets it the same way.
import '../providers/_dns-cache.mjs';
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
 * @returns {Promise<{html: string, finalUrl: string}|null>}
 */
async function fetchHtml(url, timeoutMs) {
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
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script[^>]*>/gi;
  const found = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const queue = [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
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
  const when = Date.parse(raw);
  return Number.isFinite(when) && when < now;
}

/** Distinct large description-like strings in a hydration payload (see fromEmbeddedDescription). */
function embeddedDescriptionCount(html) {
  const re = /"(descriptionHtml|descriptionPlainText|jobDescriptionHtml)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    let raw;
    try { raw = JSON.parse(`"${m[2]}"`); } catch { continue; }
    if (wordCount(String(raw).replace(/<[^>]+>/g, ' ')) >= MIN_PAGE_JD_WORDS) seen.add(raw);
  }
  return seen.size;
}

/**
 * Pick the JD out of already-downloaded page HTML. Pure — exported for tests.
 * Null when the page holds no single posting of at least MIN_PAGE_JD_WORDS
 * words. A posting past its `validThrough` date returns `{closed: true,
 * validThrough}` instead, so the caller can pass the closure on rather than
 * letting a fallback fetch score a posting the page itself calls closed.
 *
 * @param {string} html
 * @param {number} [now] epoch ms, injectable for tests
 * @returns {{text: string, method: string, closed?: boolean, validThrough?: string}|null}
 */
export function jdFromPageHtml(html, now = Date.now()) {
  const postings = jobPostingNodes(html);
  // Closed per the page's own structured data: not a JD to score. A miss hands
  // the URL back to the worker's WebFetch path and the mode's closed-posting rule.
  const expired = postings.find((node) => isPastValidThrough(node, now));
  if (expired) return { closed: true, validThrough: String(expired.validThrough), text: '', method: 'ld-json-expired' };

  const ld = fromLdJson(html);
  if (ld && wordCount(ld.text) >= MIN_PAGE_JD_WORDS) return ld;

  // The embedded-payload fallback picks the LONGEST description on the page,
  // which on a page that carries several postings is some other job's. It is
  // only trusted when the page names at most one posting and holds one
  // description-sized string, so what it returns can only be this posting's.
  // Postings without a description count too: a stub next to a described one is
  // still two postings, and the page's one big string may belong to either.
  const distinctLd = new Set(postings.map((node) => JSON.stringify([node.title ?? '', node.description ?? '']))).size;
  if (distinctLd > 1 || embeddedDescriptionCount(html) > 1) return null;
  const embedded = fromEmbeddedDescription(html);
  return embedded && wordCount(embedded.text) >= MIN_PAGE_JD_WORDS ? embedded : null;
}

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

/**
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, method: string, closed?: boolean, validThrough?: string}|null>}
 */
export async function fetchJdFromPage(url, textCap = 20_000, timeoutMs = 15_000) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (isLinkedInHost(host)) return null;
  const page = await fetchHtml(url, timeoutMs);
  if (!page) return null;
  const found = jdFromPageHtml(page.html);
  if (!found) return null;
  if (found.closed) return { url, title: '', text: '', method: found.method, closed: true, validThrough: found.validThrough };
  return { url, title: '', text: capJdText(found.text, textCap), method: found.method };
}
