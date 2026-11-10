// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Deel job-board provider — the multi-tenant ATS hosted at `jobs.deel.com/<slug>`
// (Klarna, Deel itself, ...). Targets `tracked_companies:`: one entry per employer.
// Auto-detects from `careers_url` / `api` = `https://jobs.deel.com/<slug>[/...]`.
//
// The board has no JSON list API (`/api/` is disallowed by robots.txt and the
// provider never touches it). The tenant landing page is server-rendered by Next.js
// and ships the whole inventory in its RSC ("flight") stream, so ONE page request
// returns every posting with title, locations, work arrangement, created/published
// timestamps and the description — zero per-posting requests, zero tokens:
//
//   self.__next_f.push([1,"...\"jobPostings\":[{id, title, richtextDescription:\"$1a\",
//     createdAt, job:{workArrangementEnum, jobLocations:[{location:{name,country}}]},
//     jobPostingPublications:[{currentState:{stateSlug, createdAt}}]}, ...]..."])
//
// `richtextDescription` is a reference ("$1a") to a text row (`1a:T<hexlen>,<html>`)
// elsewhere in the same stream; it is resolved here, best-effort.
//
// Compensation is deliberately NOT mapped: the payload carries `minAmount` /
// `maxAmount` with no pay interval, so annualizing would be a guess (Job.salary is
// "never inferred"). The description page the pipeline reads later has the figures.
//
// A tenant that serves its careers from its own site answers `jobs.deel.com/<slug>`
// with a redirect (Deel itself 301s to www.deel.com/careers/). The provider never
// follows it — `redirect: 'error'` is mandatory — and says so by name, so such an
// entry reads as "not on this board" rather than a generic network failure.

import { fetchTextWithRetry, isRefusedRedirectError } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const DEEL_HOST = 'jobs.deel.com';
// First path segment = the tenant slug. Restricted to URL-safe characters, so it
// needs no further encoding when the origin is rebuilt.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Pull the tenant slug out of an entry. Only the host is a trust boundary: the
 * origin is rebuilt from the fixed host and the validated slug, never from the
 * input's own path or port.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveSlug(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== DEEL_HOST) continue;
    const slug = parsed.pathname.split('/').filter(Boolean)[0];
    if (slug && SLUG_RE.test(slug)) return slug;
  }
  return null;
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: 'deel',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: `https://${DEEL_HOST}/${slug}` } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`deel: cannot derive a jobs.deel.com/<slug> board for ${entry.name}`);
    let html;
    try {
      html = await fetchTextWithRetry(ctx, `https://${DEEL_HOST}/${slug}`, { redirect: 'error' });
    } catch (err) {
      if (isRefusedRedirectError(err)) {
        throw new Error(`deel: jobs.deel.com/${slug} redirects away from the board — the company serves its careers elsewhere`);
      }
      throw err;
    }
    return parseDeelBoard(html, { slug, company: entry.name });
  },
};

/**
 * Concatenate every `self.__next_f.push([1,"..."])` chunk into the one RSC stream.
 * A chunk that won't JSON-decode is skipped (one bad chunk must not lose the board).
 * @param {string} html
 * @returns {string}
 */
export function readFlightStream(html) {
  const parts = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      parts.push(JSON.parse(`"${m[1]}"`));
    } catch { /* skip the chunk */ }
  }
  return parts.join('');
}

/**
 * Index the stream's text rows (`<id>:T<hexlen>,<payload>`) by id. The length is in
 * UTF-8 bytes, so the walk runs over a Buffer. Best-effort: on an unrecognised row
 * the walk stops and returns what it has — a description is never worth the board.
 * @param {string} stream
 * @returns {Map<string, string>}
 */
export function readTextRows(stream) {
  const texts = new Map();
  const buf = Buffer.from(stream, 'utf8');
  let o = 0;
  while (o < buf.length) {
    const colon = buf.indexOf(0x3a, o); // ':'
    if (colon < 0) break;
    const id = buf.toString('utf8', o, colon);
    if (!/^[0-9a-f]*$/.test(id)) break;
    if (buf[colon + 1] === 0x54) { // 'T' — length-prefixed text row
      const comma = buf.indexOf(0x2c, colon + 2);
      if (comma < 0) break;
      const hex = buf.toString('utf8', colon + 2, comma);
      if (!/^[0-9a-f]+$/.test(hex)) break;
      const len = parseInt(hex, 16);
      texts.set(id, buf.toString('utf8', comma + 1, comma + 1 + len));
      o = comma + 1 + len;
      if (buf[o] === 0x0a) o++; // newline between rows, when the stream has one
    } else {
      const nl = buf.indexOf(0x0a, colon + 1);
      o = nl < 0 ? buf.length : nl + 1;
    }
  }
  return texts;
}

/**
 * Parse the JSON array that starts at `stream[start]` (a `[`), string-aware.
 * @param {string} stream
 * @param {number} start
 * @returns {unknown}
 */
function readJsonArrayAt(stream, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stream.length; i++) {
    const ch = stream[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return JSON.parse(stream.slice(start, i + 1));
  }
  throw new Error('deel: unterminated array in page payload');
}

/**
 * Location text from a posting's `jobLocations`: each place with its country when
 * the name doesn't already carry it, plus "Remote" for a remote arrangement so a
 * remote-aware location_filter can see it.
 * @param {any} job
 * @returns {string}
 */
function locationOf(job) {
  const places = [];
  for (const jl of Array.isArray(job?.jobLocations) ? job.jobLocations : []) {
    const name = typeof jl?.location?.name === 'string' ? jl.location.name.trim() : '';
    if (!name) continue;
    const country = typeof jl.location.country?.name === 'string' ? jl.location.country.name.trim() : '';
    places.push(country && !name.toLowerCase().includes(country.toLowerCase()) ? `${name}, ${country}` : name);
  }
  let text = places.join('; ');
  if (job?.workArrangementEnum === 'REMOTE' && !/remote/i.test(text)) {
    text = text ? `${text}; Remote` : 'Remote';
  }
  return text;
}

/**
 * Resolve a `richtextDescription` value: a `$<hex>` reference into the text rows,
 * or an inline string. Anything else is no description.
 * @param {unknown} ref
 * @param {Map<string, string>} texts
 * @returns {string}
 */
function descriptionOf(ref, texts) {
  if (typeof ref !== 'string') return '';
  const html = /^\$[0-9a-f]+$/.test(ref) ? texts.get(ref.slice(1)) : ref;
  return html ? htmlToText(html) : '';
}

/**
 * @param {string} slug
 * @param {unknown} id
 * @returns {string | null}
 */
function postingUrl(slug, id) {
  const seg = typeof id === 'string' ? safeEncodeURIComponent(id) : null;
  return seg ? `https://${DEEL_HOST}/${slug}/job-details/${seg}/overview` : null;
}

/**
 * Parse a `jobs.deel.com/<slug>` landing page. Exported for unit tests.
 *
 * - `[]` — the documented container is present and empty (a real, empty board).
 * - throws — the page is the "Job Board Not Found" shell, carries no flight stream,
 *   or carries no `jobPostings` container (a markup change).
 * - a malformed row is dropped, never fatal.
 *
 * @param {string} html
 * @param {{slug: string, company: string}} opts
 * @returns {Array<import('./_types.js').Job>}
 */
export function parseDeelBoard(html, { slug, company }) {
  if (typeof html !== 'string' || !html) throw new Error('deel: empty response body');
  if (/<title>\s*Job Board Not Found\s*<\/title>/i.test(html)) {
    throw new Error(`deel: no board at jobs.deel.com/${slug} (Job Board Not Found)`);
  }
  const stream = readFlightStream(html);
  if (!stream) throw new Error('deel: page carries no Next.js flight data — markup changed?');

  const tenant = stream.indexOf('"jobPostings":[');
  if (tenant >= 0) {
    const rows = readJsonArrayAt(stream, tenant + '"jobPostings":'.length);
    if (!Array.isArray(rows)) throw new Error('deel: jobPostings is not an array');
    return parseTenantPostings(rows, stream, { slug, company });
  }

  throw new Error('deel: no jobPostings in page payload — markup changed?');
}

/**
 * @param {any[]} rows
 * @param {string} stream
 * @param {{slug: string, company: string}} opts
 */
function parseTenantPostings(rows, stream, { slug, company }) {
  const texts = rows.some((r) => typeof r?.richtextDescription === 'string' && r.richtextDescription.startsWith('$'))
    ? readTextRows(stream)
    : new Map();
  const out = [];
  for (const r of rows) {
    const title = typeof r?.title === 'string' ? r.title.trim() : '';
    const url = postingUrl(slug, r?.id);
    if (!title || !url) continue;
    // Prefer the moment the posting went live over the record's creation (a draft can
    // sit for weeks); fall back to createdAt when the publication state is absent.
    const published = Array.isArray(r.jobPostingPublications)
      ? r.jobPostingPublications.map((p) => p?.currentState).find((s) => typeof s?.stateSlug === 'string' && s.stateSlug.startsWith('published'))
      : undefined;
    const description = descriptionOf(r.richtextDescription, texts);
    out.push({
      title,
      url,
      company,
      location: locationOf(r.job),
      postedAt: toEpochMs(published?.createdAt) ?? toEpochMs(r.createdAt),
      externalId: /** @type {string} */ (r.id),
      ...(description ? { description } : {}),
    });
  }
  return out;
}
