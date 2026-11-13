// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Munich Startup provider — board-wide feed for `job_boards:`.
// https://www.munich-startup.de/jobs is the job pinboard of Munich Startup,
// the startup portal of the City of Munich's economic-development department.
// Startups post their openings there directly ("Stellenangebote"), so every
// row is the posting company's own ad; reading and applying is free and needs
// no account. Small board: 28 open ads on 2026-10-28.
//
// The page is Next.js App Router output. The listing arrives as JSON inside
// the `self.__next_f.push([1,"…"])` RSC chunks:
//
//   "listing":{"data":[{id,type:"AdJob",status,title,company:{name},
//              created_label:"vor 6 Wochen",meta:{employment,...}}, ...],
//              "meta":{current_page,last_page,per_page,total}}
//
// That JSON is read instead of the HTML cards, whose classes are build
// hashes. Pages are `?page=N` (1-based, 15 per page), server-rendered.
// robots.txt: `Allow: /`, `Disallow: /api/` for `User-agent: *` (2026-10-28);
// only `/jobs` is requested.
//
// What the listing does not carry:
//   - a location: the board is Munich-only, but no row names a city, so
//     `location` is left empty rather than guessed;
//   - a date: only a German relative label ("vor 2 Wochen"). `postedAt` is
//     derived from it as now minus the stated amount, so it is approximate
//     (week/month granularity) and errs toward newer.
//
//   - name: Munich Startup
//     provider: munich-startup
//     enabled: true

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const ORIGIN = 'https://www.munich-startup.de';
const LIST_URL = `${ORIGIN}/jobs`;
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_CAP = 50;
const INTER_PAGE_DELAY_MS = 250;
const NOT_FOUND = 'munich-startup: "listing" JSON not found in the page — markup changed?';

/** Concatenated RSC flight text of a Next.js App Router page. */
function flightText(html) {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    let chunk;
    try {
      chunk = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (Array.isArray(chunk) && typeof chunk[1] === 'string') text += chunk[1];
  }
  return text;
}

/** The balanced JSON object starting at `start` (a `{`), or null. */
function sliceObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Pull the `listing` object out of a /jobs page. Exported for unit tests.
 *
 * Throws when the page carries no `"listing":{...}` with a `data` array (a
 * markup change); an empty `data` array is an empty board.
 *
 * @param {string} html
 * @returns {{ data: any[], lastPage: number | null, perPage: number | null, total: number | null }}
 */
export function parseListing(html) {
  if (typeof html !== 'string' || !html) throw new Error(NOT_FOUND);
  const text = flightText(html);
  const key = /"listing":\s*/.exec(text);
  if (!key) throw new Error(NOT_FOUND);
  const raw = sliceObject(text, key.index + key[0].length);
  if (!raw) throw new Error(NOT_FOUND);
  let listing;
  try {
    listing = JSON.parse(raw);
  } catch {
    throw new Error(NOT_FOUND);
  }
  if (!listing || !Array.isArray(listing.data)) {
    const got = listing && typeof listing === 'object' ? Object.keys(listing).join(', ') : typeof listing;
    throw new Error(`munich-startup: unexpected listing — expected data[], got: [${got}]`);
  }
  const meta = listing.meta && typeof listing.meta === 'object' ? listing.meta : {};
  const int = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  return { data: listing.data, lastPage: int(meta.last_page), perPage: int(meta.per_page), total: Number.isInteger(meta.total) ? meta.total : null };
}

const UNIT_MS = {
  minute: 60_000,
  stunde: 3_600_000,
  tag: 86_400_000,
  woche: 7 * 86_400_000,
  monat: 30 * 86_400_000,
  jahr: 365 * 86_400_000,
};

/**
 * Approximate epoch ms from a German relative label ("vor 3 Tagen",
 * "vor 1 Woche", "vor einem Monat"); undefined when the label doesn't parse.
 * Exported for unit tests.
 *
 * @param {unknown} label
 * @param {number} [now]
 * @returns {number | undefined}
 */
export function relativeLabelToEpochMs(label, now = Date.now()) {
  if (typeof label !== 'string') return undefined;
  const s = label.trim().toLowerCase();
  if (s === 'heute' || s === 'gerade eben' || s === 'jetzt') return now;
  if (s === 'gestern') return now - UNIT_MS.tag;
  const m = s.match(/^vor\s+(\d+|einer?|einem)\s+(minute|stunde|tag|woche|monat|jahr)/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  if (!Number.isFinite(n)) return undefined;
  return now - n * UNIT_MS[m[2]];
}

/**
 * Map one listing row to a Job, or null for a row with no usable id/title or
 * one the board no longer shows as active. Exported for unit tests.
 *
 * @param {any} row
 * @param {number} [now]
 */
export function toJob(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.status === 'string' && row.status !== 'active') return null;
  const id = typeof row.id === 'number' || typeof row.id === 'string' ? String(row.id).trim() : '';
  if (!/^\d+$/.test(id)) return null;
  const seg = safeEncodeURIComponent(id);
  if (seg === null) return null;
  const title = typeof row.title === 'string' ? decodeEntities(row.title).trim() : '';
  if (!title) return null;
  const company = typeof row.company?.name === 'string' ? decodeEntities(row.company.name).trim() : '';
  /** @type {any} */
  const job = {
    title,
    url: `${ORIGIN}/jobs/anzeige/${seg}`,
    company: company || 'Munich Startup',
    location: '',
  };
  const postedAt = relativeLabelToEpochMs(row.created_label, now);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'munich-startup',

  // One fixed board; no per-entry URL to match.
  detect(entry) {
    return entry?.provider === 'munich-startup' ? { url: LIST_URL } : null;
  },

  async fetch(entry, ctx) {
    const label = entry?.name || 'Munich Startup';
    const ctxMax = Number(ctx?.maxPages);
    const probing = ctxMax > 0;
    const maxPages = Math.min(resolveMaxPages(entry), probing ? ctxMax : Infinity);
    const now = Date.now();

    const out = [];
    const seen = new Set();
    let lastPage = Infinity;
    /** @type {'complete' | 'cap' | 'probe' | 'fetch-error'} */
    let stopReason = 'complete';

    for (let page = 1; page <= maxPages && page <= lastPage; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = page === 1 ? LIST_URL : `${LIST_URL}?page=${page}`;
      let listing;
      try {
        const html = await fetchTextWithRetry(ctx, url, { redirect: 'error', headers: { accept: 'text/html' } });
        listing = parseListing(html);
      } catch (err) {
        if (page === 1 || probing) throw err;
        const cause = err instanceof Error ? err.message : String(err);
        console.error(`⚠️  munich-startup: ${label} truncated at page ${page} (${out.length} jobs): ${cause}`);
        stopReason = 'fetch-error';
        break;
      }
      if (listing.lastPage !== null) lastPage = Math.min(listing.lastPage, MAX_PAGES_CAP);

      for (const row of listing.data) {
        const job = toJob(row, now);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }

      const rawCount = listing.data.length;
      if (rawCount === 0 || (listing.perPage !== null && rawCount < listing.perPage)) break;
      if (page === maxPages && page < lastPage) stopReason = probing ? 'probe' : 'cap';
    }

    if (stopReason === 'cap') {
      console.error(`⚠️  munich-startup: ${label} stopped at max_pages (${maxPages}) with more pages left — raise max_pages on this entry`);
    }
    return out;
  },
};
