// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Dover provider — single-company ATS adapter (→ tracked_companies:).
// Auto-detects a Dover-hosted careers page,
// `https://app.dover.com/<Company>/careers/<board-uuid>`, and reads the
// public zero-auth list endpoint the page itself calls:
//   GET https://app.dover.com/api/v1/careers-page/<board-uuid>/jobs?limit=300&offset=<n>
// Response: Django REST Framework pagination, `{ count, next, previous, results }`,
// each result `{ id, title, locations: [{ location_type, location_option:
// { display_name, location_type, city, state, country }, name, is_primary }],
// workplace_type, is_published, is_sample }`. No posting date and no
// description in the list payload.
//
// The posting URL is the apply page Dover's own careers page links to,
// `https://app.dover.com/apply/<Company>/<job-id>`, with <Company> taken from
// the careers_url path so the URL matches the link a user copies off the page.
//
// Location: Dover tags a worldwide-remote role with a REGION option whose
// display_name is "International" and whose country is "US". Read naively
// (city/state/country), that reads as a US role; at least one aggregator
// re-listing turned it into "International Falls, MN, USA". This provider
// renders it the way Dover's page does, "Remote (International)".

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const HOST = 'app.dover.com';
const API_BASE = `https://${HOST}/api/v1/careers-page`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The page size Dover's own careers page requests.
const PAGE_SIZE = 300;

// Page ceiling, independent of what `count` / `next` report. 5 * 300 = 1,500
// postings is already far beyond any Dover customer seen (startups, 1-10 roles).
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 20;

const INTER_PAGE_DELAY_MS = 200;
const RETRY_POLICY = { retries: 2 };

const STOP_REASON = {
  COMPLETE: 'complete',
  CAP: 'cap',
  FETCH_ERROR: 'fetch-error',
};

/**
 * Resolve `{ company, board }` from a careers_url like
 * `https://app.dover.com/Acme/careers/<uuid>`. Returns null for any other host,
 * a non-https URL, or a path without a `<company>/careers/<uuid>` prefix.
 * @param {import('./_types.js').PortalEntry} entry
 */
export function resolveBoard(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) return null;
  const [company, marker, board] = parsed.pathname.split('/').filter(Boolean);
  if (!company || marker !== 'careers' || !board || !UUID_RE.test(board)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(company);
  } catch {
    decoded = company;
  }
  return { company: decoded, board: board.toLowerCase() };
}

/** @param {string} board @param {number} page */
function apiUrlFor(board, page) {
  // board is config-derived and already restricted to UUID_RE.
  const url = new URL(`${API_BASE}/${encodeURIComponent(board)}/jobs`);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(page * PAGE_SIZE));
  return url.href;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Render one Dover location the way Dover's careers page does:
 * REMOTE → "Remote (<place>)", HYBRID → "<place> (Hybrid)", otherwise "<place>".
 * @param {any} loc
 */
function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const option = loc.location_option && typeof loc.location_option === 'object' ? loc.location_option : {};
  const place = [option.display_name, loc.name].find((v) => typeof v === 'string' && v.trim())?.trim() || '';
  const type = typeof loc.location_type === 'string' ? loc.location_type.toUpperCase() : '';
  if (type === 'REMOTE') return place ? `Remote (${place})` : 'Remote';
  if (type === 'HYBRID') return place ? `${place} (Hybrid)` : 'Hybrid';
  return place;
}

/**
 * Parse one page of the careers-page jobs endpoint. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      `https://app.dover.com/apply/<Company>/<id>` — <Company> from
 *               the careers_url, <id> host-controlled and surrogate-safe encoded.
 *   - company:  the portal entry name.
 *   - location: every location rendered by formatLocation, primary first,
 *               joined with " · "; "Remote" when there are none and
 *               workplace_type is REMOTE.
 * Unpublished (`is_published: false`) and sample (`is_sample: true`) rows are
 * dropped.
 *
 * @param {any} json
 * @param {{ companyName: string, companySegment: string }} opts
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string}>, rawCount: number, hasNext: boolean }}
 */
export function parseDoverPage(json, { companyName, companySegment }) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`dover: unexpected response — expected results[], got: [${got}]`);
  }
  const rawCount = json.results.length;
  const jobs = [];
  for (const j of json.results) {
    if (!j || typeof j !== 'object') continue;
    if (j.is_published === false || j.is_sample === true) continue;
    const title = typeof j.title === 'string' ? j.title.trim() : '';
    if (!title) continue;
    const idSeg = typeof j.id === 'string' && j.id ? safeEncodeURIComponent(j.id) : null;
    if (!idSeg) continue;

    const locs = Array.isArray(j.locations) ? [...j.locations] : [];
    locs.sort((a, b) => Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary)));
    let location = [...new Set(locs.map(formatLocation).filter(Boolean))].join(' · ');
    if (!location && typeof j.workplace_type === 'string' && j.workplace_type.toUpperCase() === 'REMOTE') {
      location = 'Remote';
    }

    jobs.push({
      title,
      url: `https://${HOST}/apply/${companySegment}/${idSeg}`,
      company: companyName,
      location,
    });
  }
  return { jobs, rawCount, hasNext: typeof json.next === 'string' && json.next !== '' };
}

/** @type {Provider} */
export default {
  id: 'dover',

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: apiUrlFor(board.board, 0) } : null;
  },

  /**
   * @param {{ name?: string, careers_url?: string, max_pages?: number }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   */
  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`dover: cannot derive API URL for ${entry.name}`);
    // Config-derived segment: encoded once, outside the row loop.
    const companySegment = encodeURIComponent(board.company);
    const companyName = entry.name || board.company;

    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);
    const probing = ctxCap !== Infinity;

    const jobs = [];
    let stopReason = STOP_REASON.COMPLETE;
    let page = 0;
    for (; page < pagesToFetch; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let json;
      try {
        // A status-less failure is retryable. verify-portals probes with
        // ctx.maxPages set and wants that failure back at once, so a probe
        // gets no retries. A normal scan keeps RETRY_POLICY (two retries).
        json = await fetchJsonWithRetry(
          ctx,
          apiUrlFor(board.board, page),
          { redirect: 'error' },
          probing ? { retries: 0 } : RETRY_POLICY,
        );
      } catch (err) {
        if (probing || page === 0) throw err;
        const attempts = err?.attempts ?? RETRY_POLICY.retries + 1;
        console.error(`⚠️  dover: ${entry.name} truncated at page ${page + 1} of ${pagesToFetch} after ${attempts} attempts (${jobs.length} jobs): ${err.message}`);
        stopReason = STOP_REASON.FETCH_ERROR;
        break;
      }
      const { jobs: pageJobs, rawCount, hasNext } = parseDoverPage(json, { companyName, companySegment });
      jobs.push(...pageJobs);
      // Natural end: a short page (raw count, before row filtering) or no `next`.
      // Break WITHOUT incrementing page so a short last-allowed page is not
      // mistaken for a ceiling stop below.
      if (rawCount < PAGE_SIZE || !hasNext) break;
    }

    if (stopReason === STOP_REASON.COMPLETE && page === pagesToFetch && pagesToFetch === maxPages) {
      stopReason = STOP_REASON.CAP;
      console.error(`⚠️  dover: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};
