// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { htmlToText } from './_html-to-text.mjs';

// Garena careers provider — single-company provider (like ibm.mjs/dassault.mjs):
// one fixed host, no per-tenant discovery.
//
//   POST https://careers.garena.com/api/job/list?office=<office>
//
// No auth. Unusually for a single-company provider (most of which are plain
// GET), the body is an empty JSON object. Verified live: the endpoint 200s
// with no body at all too, and `office` does not filter the result — every
// office code tried, including a made-up one, returned the identical 98-job
// list. It's still sent because it's part of the real request shape rather
// than relying on undocumented leniency, and — unlike the list API — the
// public job page DOES use it in its path
// (`https://careers.garena.com/<office>/careers/<id>`, confirmed live: the
// page is server-rendered per job, with the posting's own title in <title>),
// so a wrong office only breaks the job links, not the listing itself.
//
// Response shape: { jobs: [{ id, title, tags: { location: string[], ... },
// description }] }. One request, no pagination — `jobs` is the whole board.

const API_URL = 'https://careers.garena.com/api/job/list';
const HOST = 'careers.garena.com';
const DEFAULT_OFFICE = 'global';

/**
 * Normalizes one Garena API response into job entries.
 * Throws if the response doesn't carry the expected `jobs[]` shape, so a
 * silent endpoint change surfaces as a hard error instead of empty results.
 * @param {any} json - The API response.
 * @param {{ name?: string, garena?: { office?: string } }} entry
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string}>}
 */
export function parseGarenaResponse(json, entry) {
  const jobs = json && Array.isArray(json.jobs) ? json.jobs : null;
  if (!jobs) {
    throw new Error(`garena: unexpected API response — expected jobs[], got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }

  const officeSegment = urlSegment('office', resolveOffice(entry));
  const company = (entry && entry.name) || 'Garena';

  const out = [];
  for (const j of jobs) {
    if (!j || typeof j.title !== 'string' || j.title.trim() === '') continue;
    const id = j.id != null ? String(j.id).trim() : '';
    if (!id) continue;

    const locations = Array.isArray(j.tags && j.tags.location)
      ? j.tags.location.filter((l) => typeof l === 'string' && l.trim())
      : [];

    /** @type {{title: string, url: string, company: string, location: string, description?: string}} */
    const job = {
      title: j.title.trim(),
      url: `https://${HOST}/${officeSegment}/careers/${urlSegment('id', id)}`,
      company,
      location: locations.join(', '),
    };
    const desc = typeof j.description === 'string' ? htmlToText(j.description).trim() : '';
    if (desc) job.description = desc;

    out.push(job);
  }
  return out;
}

/** @param {{ garena?: { office?: string } }} entry */
function resolveOffice(entry) {
  const office = entry && entry.garena && entry.garena.office;
  return typeof office === 'string' && office.trim() ? office.trim() : DEFAULT_OFFICE;
}

/**
 * Escapes an untrusted value before it is interpolated into a Garena URL.
 * `office` is user config and `id` is remote API data, so neither may widen
 * the URL we intended: separators (`/`, `?`, `#`, ...) are percent-escaped,
 * and `.`/`..` are rejected outright because escaping leaves them intact as
 * traversal segments.
 * @param {string} name - Field name, for the error message.
 * @param {string} value
 * @returns {string}
 */
function urlSegment(name, value) {
  if (value === '.' || value === '..') {
    throw new Error(`garena: ${name} is not a usable URL segment: ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}

/** @type {Provider} */
export default {
  id: 'garena',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    try {
      const host = new URL(url).host.toLowerCase();
      if (host === HOST) return { url };
    } catch {
      /* not an absolute URL */
    }
    return null;
  },

  /**
   * Fetches and normalizes postings from Garena's public careers API.
   * @param {{ name?: string, garena?: { office?: string } }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string}>>}
   */
  async fetch(entry, ctx) {
    const url = `${API_URL}?office=${urlSegment('office', resolveOffice(entry))}`;

    // redirect:'error' is the SSRF guard (a server-side redirect can't be
    // followed to a private address). The empty-object body matches what the
    // live endpoint actually receives from the careers site itself.
    const json = await ctx.fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({}),
      redirect: 'error',
    });

    return parseGarenaResponse(json, entry);
  },
};
