// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// CareerPuck provider — a single-company ATS adapter for `tracked_companies:`.
// Every employer has a board at `https://app.careerpuck.com/job-board/<permalink>`;
// detect() claims that board and any path under it, so a posting link
// (`/job-board/<permalink>/job/<id>`) resolves to the board it belongs to.
//
// Data path: the board page is a client-side app whose HTML carries no
// postings. The app loads its list from a public, anonymous JSON endpoint,
// `GET https://api.careerpuck.com/v1/public/job-boards/<permalink>` (no
// cookie, token or extra header), whose envelope holds `jobs[]` next to the
// board's `employerProfile`, `departments` and `offices`. That one response
// carries every posting with its full description, so a scan is one request
// and needs no pagination. Only this public endpoint is read; the
// authenticated `/v1/employers/...` routes answer 401 and are never used.
//
// Description: `content` is HTML that has been entity-escaped, with the
// punctuation written as named references too (`&lt;h3&gt;`, `&semi;`,
// `&comma;`, `&lpar;`). It is decoded once with the full WHATWG table
// (`bareNumeric` mode) and then reduced to text by htmlToText, which strips
// markup before and after each further decode.
//
// Posting URL: `publicUrl`, accepted only on an https `app.careerpuck.com`
// host. `applyUrl` points at the employer's upstream ATS (iCIMS, Workday, ...)
// on a host this provider cannot vouch for, so it is not read.
//
// Failure answers: an unknown permalink answers 404, which reaches
// verify-portals as a 404 naming the board. A board with no open roles
// answers 200 with `jobs: []`, which is an empty board. Rows whose `status`
// is anything but `public` are skipped.

import { fetchJsonWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { coerceId } from './_ids.mjs';
import { workplaceField } from './_workplace-type.mjs';

export const CAREERPUCK_APP_HOST = 'app.careerpuck.com';
const API_ORIGIN = 'https://api.careerpuck.com';

// `/job-board/<permalink>` — the permalink is the only part of the path read.
const BOARD_PATH_RE = /^\/job-board\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})(?:\/|$)/;

/**
 * The board permalink of a `https://app.careerpuck.com/job-board/<permalink>`
 * URL, or null for any other URL.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function boardPermalinkOf(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== CAREERPUCK_APP_HOST) return null;
  const m = parsed.pathname.match(BOARD_PATH_RE);
  return m ? m[1] : null;
}

/**
 * The board permalink from the entry's `api` or `careers_url`.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolvePermalink(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    const permalink = boardPermalinkOf(raw);
    if (permalink) return permalink;
  }
  return null;
}

/** @param {string} permalink */
function apiUrl(permalink) {
  return `${API_ORIGIN}/v1/public/job-boards/${encodeURIComponent(permalink)}`;
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The posting page URL from `publicUrl`, accepted only on an https
 * `app.careerpuck.com` host.
 * @param {unknown} raw
 * @returns {string | null}
 */
function postingUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== CAREERPUCK_APP_HOST) return null;
  return u.href;
}

/**
 * Plain text of the entity-escaped `content` HTML.
 * @param {unknown} content
 * @returns {string}
 */
export function descriptionText(content) {
  if (typeof content !== 'string' || !content) return '';
  return htmlToText(decodeEntities(content, { bareNumeric: true }));
}

/**
 * Map one API row to a Job, or null when it is not public or lacks a title or
 * a usable posting URL.
 * @param {any} row
 * @param {string} companyName
 * @param {string} permalink  board permalink, for `listingIdentity`
 */
export function parseCareerPuckJob(row, companyName, permalink) {
  if (!row || typeof row !== 'object') return null;
  if (row.status !== 'public') return null;
  const title = str(row.title);
  const url = postingUrl(row.publicUrl);
  if (!title || !url) return null;
  /** @type {import('./_types.js').Job} */
  const job = { title, url, company: companyName, location: str(row.location) };
  const postedAt = toEpochMs(row.postedAt);
  if (postedAt !== undefined) job.postedAt = postedAt;
  const description = descriptionText(row.content);
  if (description) job.description = description;
  const requisitionId = coerceId(row.requisitionId);
  if (requisitionId) job.requisitionId = requisitionId;
  Object.assign(job, workplaceField(row.workplaceType));
  const postingId = typeof row.permalink === 'string' && row.permalink && row.permalink === row.permalink.trim()
    ? row.permalink
    : '';
  if (postingId && !/[\u0000-\u001f\u007f]/.test(postingId)) {
    job.listingIdentity = { ats_provider: 'careerpuck', board_slug: permalink, posting_id: postingId };
  }
  return job;
}

/**
 * Read the board response. Returns `[]` for a present, empty `jobs` array and
 * throws when the body is not the documented `{ jobs: [] }` envelope.
 * @param {any} json
 * @param {string} companyName
 * @param {string} permalink
 * @returns {import('./_types.js').Job[]}
 */
export function parseCareerPuckBoard(json, companyName, permalink) {
  const rows = json && typeof json === 'object' && Array.isArray(json.jobs) ? json.jobs : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`careerpuck: unexpected response — expected jobs[], got: [${got}]`);
  }
  const company = str(companyName) || str(json.employerProfile?.name);
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  const seen = new Set();
  for (const row of rows) {
    const job = parseCareerPuckJob(row, company, permalink);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'careerpuck',

  detect(entry) {
    const permalink = resolvePermalink(entry);
    return permalink ? { url: apiUrl(permalink) } : null;
  },

  async fetch(entry, ctx) {
    const permalink = resolvePermalink(entry);
    if (!permalink) {
      throw new Error(`careerpuck: no app.careerpuck.com/job-board/<permalink> in careers_url/api for ${entry?.name}`);
    }
    let json;
    try {
      json = await fetchJsonWithRetry(ctx, apiUrl(permalink), { redirect: 'error' });
    } catch (err) {
      if (err?.status === 404) {
        const gone = new Error(`careerpuck: board "${permalink}" answered 404 — no such CareerPuck job board`);
        /** @type {any} */ (gone).status = 404;
        throw gone;
      }
      throw err;
    }
    return parseCareerPuckBoard(json, entry.name, permalink);
  },
};
