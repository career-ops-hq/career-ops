// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { fetchTextWithRetry } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { readFlightStream } from './deel.mjs';

// Bolt provider — Bolt's own careers site (bolt.eu/en/careers/positions/). A single-company
// `tracked_companies:` adapter, like dassault.mjs and ibm.mjs. The site is a Next.js app-router
// page with no ATS widget and no JSON API: every open position ships in the one HTML response,
// as the `parsedJobs` prop inside the flight stream (`self.__next_f.push([1,"…"])` chunks).
//
//   { id, header: { roleTitle, parentTeamTitle, locations: [{ city, country, countryCode }] },
//     body: { description, jobPostedDate: "$D2026-10-07T00:00:00.000Z", … } }
//
// The 20 cards on screen are a client-side paging of that array, so there is nothing to page:
// one GET returns the whole board (187 postings on 2026-11-18, about 590 KB). The inventory is
// returned as it is; location is left to the scanner's filters.
//
// The flight stream is joined by `readFlightStream` from deel.mjs (the same Next.js app-router
// stream, with the same rule: one chunk that will not decode is skipped, not fatal).
//
// Config (portals.yml):
//   - name: Bolt
//     careers_url: https://bolt.eu/en/careers/positions/
//     provider: bolt                                        # required: bolt.eu is a branded domain, never auto-detected
//     enabled: true

// The listing is always read from this fixed page, whatever path or locale the entry carries:
// only the host is a trust boundary.
const POSITIONS_URL = 'https://bolt.eu/en/careers/positions/';
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARSED_JOBS_KEY = '"parsedJobs":[';

/**
 * The `parsedJobs` array of the flight stream, found with a string-aware bracket match.
 * Returns null when the key is absent or the array never closes.
 * @param {string} flight
 * @returns {unknown[] | null}
 */
function extractParsedJobs(flight) {
  const key = flight.indexOf(PARSED_JOBS_KEY);
  if (key < 0) return null;
  const start = key + PARSED_JOBS_KEY.length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < flight.length; i++) {
    const c = flight[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      if (--depth === 0) {
        try {
          const rows = JSON.parse(flight.slice(start, i + 1));
          return Array.isArray(rows) ? rows : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// "$D2026-10-07T00:00:00.000Z" is a Next.js date marker.
/** @param {unknown} value @returns {number | undefined} */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value.replace(/^\$D/, ''));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the careers page HTML into normalized jobs. Throws when the page carries no
 * `parsedJobs` array, or carries positions of which none parses (a markup change); an empty
 * array is an empty board.
 * @param {string} html
 * @param {string} [entryName]
 */
export function parsePositions(html, entryName) {
  const rows = typeof html === 'string' ? extractParsedJobs(readFlightStream(html)) : null;
  if (!rows) {
    throw new Error('bolt: job data (parsedJobs) not found in the careers page — markup changed?');
  }

  const jobs = [];
  const seen = new Set();
  for (const row of rows) {
    const r = /** @type {any} */ (row);
    const id = typeof r?.id === 'string' ? r.id : '';
    const title = typeof r?.header?.roleTitle === 'string' ? r.header.roleTitle.trim() : '';
    if (!JOB_ID_RE.test(id) || !title || seen.has(id)) continue;
    const seg = safeEncodeURIComponent(id);
    if (seg === null) continue;
    seen.add(id);

    const locs = Array.isArray(r.header.locations) ? r.header.locations : [];
    const places = locs
      .map((/** @type {any} */ l) => [l?.city, l?.country].filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()).join(', '))
      .filter(Boolean);

    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `${POSITIONS_URL}${seg}/`,
      company: entryName || 'Bolt',
      location: places.join('; '),
      listingIdentity: { ats_provider: 'bolt', board_slug: 'bolt', posting_id: id },
    };
    if (places.length) job.locations = places;
    // Structured country code only when every place carries one and they all agree: a place
    // without a code could be in another country, so the posting is then left without `country`.
    const codes = locs.map((/** @type {any} */ l) => (typeof l?.countryCode === 'string' ? l.countryCode.trim() : ''));
    if (codes.length > 0 && codes.every(Boolean) && new Set(codes).size === 1) job.country = codes[0];
    const postedAt = toEpochMs(r.body?.jobPostedDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  // Positions present but none parsed: the row layout changed.
  if (rows.length > 0 && jobs.length === 0) {
    throw new Error('bolt: positions present but none parsed — markup changed?');
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'bolt',

  // No detect(): bolt.eu is a branded domain, so the provider is reached only by an explicit
  // `provider: bolt` entry (providers/ADDING_A_PROVIDER.md, section 1).

  async fetch(entry, ctx) {
    const html = await fetchTextWithRetry(ctx, POSITIONS_URL, {
      redirect: 'error',
      headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
    });
    return parsePositions(html, entry?.name);
  },
};
