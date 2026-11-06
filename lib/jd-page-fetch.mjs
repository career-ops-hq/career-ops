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
 * fetcher in browser-extract.mjs has: a literal-host check, a DNS check for
 * hosts that resolve into private space, and the same two checks on every
 * redirect hop (a public page may 302 to http://169.254.169.254/).
 */

import { rejectPrivateOrInvalid, validateUrlSecurity } from '../liveness-browser.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { fromLdJson, fromEmbeddedDescription, wordCount } from '../batch/jd-rescue.mjs';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
// Same floor jd-rescue.mjs uses: below it the "JD" is a stub, not a posting.
export const MIN_PAGE_JD_WORDS = 80;

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
      await validateUrlSecurity(current);
      const res = await fetch(current, {
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': DEFAULT_USER_AGENT },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) return null;
        current = new URL(location, current).href;
        continue;
      }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
      const type = res.headers.get('content-type') || '';
      if (type && !/html|xml/i.test(type)) { await res.body?.cancel().catch(() => {}); return null; }
      const html = await readCapped(res, MAX_BODY_BYTES);
      return html == null ? null : { html, finalUrl: current };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the JD out of already-downloaded page HTML. Pure — exported for tests.
 * Null when neither source holds a posting of at least MIN_PAGE_JD_WORDS words.
 *
 * @param {string} html
 * @returns {{text: string, method: string}|null}
 */
export function jdFromPageHtml(html) {
  for (const candidate of [fromLdJson(html), fromEmbeddedDescription(html)]) {
    if (candidate && wordCount(candidate.text) >= MIN_PAGE_JD_WORDS) return candidate;
  }
  return null;
}

/**
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, method: string}|null>}
 */
export async function fetchJdFromPage(url, textCap = 20_000, timeoutMs = 15_000) {
  const page = await fetchHtml(url, timeoutMs);
  if (!page) return null;
  const found = jdFromPageHtml(page.html);
  if (!found) return null;
  const text = found.text.length > textCap ? `${found.text.slice(0, textCap)}…` : found.text;
  return { url, title: '', text, method: found.method };
}
