// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Remotli provider — remotli.ch, a curated board of remote roles at Swiss
// companies (paid in CHF). Public JSON API, no auth:
//
//   https://remotli.ch/api/jobs?page=N&limit=50
//   → { jobs: [ { jobs: {...}, companies: {...} }, ... ],
//       pagination: { page, limit, total, totalPages } }
//
// Note the doubly-nested shape: each element of the top-level `jobs` array is a
// join row `{ jobs, companies }`, and the posting itself lives under `.jobs`.
//
// Wire in as a tracked_companies entry:
//
//   - name: Remotli (Swiss remote board)
//     provider: remotli
//     careers_url: https://remotli.ch/
//     enabled: true
//
// --- Design notes -----------------------------------------------------------
//
// URL / dedup key. The API exposes `applyUrl` pointing at the original ATS
// (join.com, Greenhouse, …). We deliberately do NOT use it as the emitted URL.
// Every other provider here is host-locked to its own domain (see the off-host
// drop in tests/providers/arbeitnow.test.mjs), and emitting arbitrary
// third-party hosts would both break that convention and hand the dedup key to
// a URL whose format may not match what the direct ATS provider emits anyway.
// We emit the canonical remotli page instead and let the #1597 SimHash
// fingerprint catch genuine cross-listings — which works here precisely because
// this API ships the full `description` for free.
//
// Employer attribution. Many reposting aggregators collapse `company` to the
// aggregator's own name, which makes tracker rows unattributable and invites
// double submissions through two channels. This board carries the real employer
// in `company` (plus a `companies` join row), so rows land under the actual
// employer and the cross-listing check has a real company to compare against.
//
// Liveness is built in: rows carry `status`, and we emit only `active`.
//
// Shared helpers: decodeEntities comes from ./_html-entities.mjs, the canonical
// decoder. toEpochMs is inlined instead, matching personio.mjs — small enough
// that centralizing it would buy nothing.

import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://remotli.ch';
const API_PATH = '/api/jobs';
// The server caps `limit` at 50 regardless of what is requested (?limit=200
// still returns 50), so ask for exactly the cap and page through.
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
const HOST_RE = /^(www\.)?remotli\.ch$/i;

/** NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0. */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Description → plain text for content_filter and the #1597 fingerprint.
// Uses the shared decodeEntities helper rather than a local decoder: that helper
// exists precisely because hand-rolled copies kept drifting on the numeric-entity
// range guard (#1639), where checking only Number.isFinite still lets
// String.fromCodePoint throw a RangeError on "&#99999999;" and crash the whole
// parse. Same one-line shape as agentic-jobs.mjs / avature.mjs.
//
// Strip once, then decode — the house order, and it is now the correct one for
// this source. An earlier revision stripped on both sides of the decode because
// most rows arrived entity-encoded (`&lt;p&gt;…`), so a single leading strip
// found no tags and decoding afterwards resurrected the markup as literal "<p>"
// text. That second pass was the root cause of two HIGH CodeQL alerts
// (js/double-escaping, js/bad-tag-filter), and it was compensating for a defect
// on the board's side rather than anything intrinsic to the format: /api/jobs
// mixed entity-encoded and raw-HTML descriptions row by row. The API now decodes
// on the way out and always answers with real HTML, so one strip is sufficient
// and the compensating pass is gone.
function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Fold `location` together with any extra `allLocations` into one string. */
function resolveLocation(job) {
  const primary = typeof job.location === 'string' ? job.location.trim() : '';
  const all = Array.isArray(job.allLocations)
    ? job.allLocations.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim())
    : [];
  const merged = [];
  for (const l of [primary, ...all]) {
    if (l && !merged.some(m => m.toLowerCase() === l.toLowerCase())) merged.push(l);
  }
  return merged.join('; ');
}

/** Map remotli's salaryMin/Max/Currency onto the {min,max,currency} shape
 *  scan.mjs's buildSalaryFilter consumes. Returns null when unusable. */
function resolveSalary(job) {
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const min = num(job.salaryMin);
  const max = num(job.salaryMax);
  if (min == null && max == null) return null;
  const currency = typeof job.salaryCurrency === 'string' ? job.salaryCurrency.trim().toUpperCase() : '';
  const lo = min ?? max;
  const hi = max ?? min;
  return { min: Math.min(lo, hi), max: Math.max(lo, hi), currency };
}

/**
 * Normalize one API join row `{ jobs, companies }` into a Job.
 * Returns null for rows that are unusable or not currently open.
 * Exported for tests.
 * @param {any} row
 * @param {string} [fallbackCompany]
 */
export function normalizeRemotliJob(row, fallbackCompany) {
  if (!row || typeof row !== 'object') return null;
  const job = row.jobs && typeof row.jobs === 'object' ? row.jobs : null;
  if (!job) return null;

  const title = typeof job.title === 'string' ? job.title.trim() : '';
  if (!title) return null;

  // Only currently-open roles. The board also carries closed/draft rows, and
  // emitting them would put dead links in the pipeline — the exact staleness
  // problem that made the WebSearch-based remotli query useless.
  const status = typeof job.status === 'string' ? job.status.trim().toLowerCase() : '';
  if (status && status !== 'active') return null;

  const slug = typeof job.slug === 'string' ? job.slug.trim() : '';
  if (!slug || /[^a-z0-9._~-]/i.test(slug)) return null; // host-locked, path-safe slugs only
  const url = `${ORIGIN}/jobs/${slug}`;

  const companies = row.companies && typeof row.companies === 'object' ? row.companies : {};
  const company =
    (typeof job.company === 'string' && job.company.trim()) ||
    (typeof companies.name === 'string' && companies.name.trim()) ||
    (fallbackCompany || 'Remotli');

  /** @type {any} */
  const out = { title, url, company, location: resolveLocation(job) };

  const description = htmlToText(job.description);
  if (description) out.description = description;

  const postedAt = toEpochMs(job.publishedAt || job.createdAt);
  if (postedAt !== undefined) out.postedAt = postedAt;

  const salary = resolveSalary(job);
  if (salary) out.salary = salary;

  return out;
}

/** Guard the API URL: HTTPS + remotli.ch only. */
function assertRemotliUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`remotli: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`remotli: URL must use HTTPS: ${url}`);
  if (!HOST_RE.test(parsed.hostname))
    throw new Error(`remotli: untrusted hostname "${parsed.hostname}" — must be remotli.ch`);
  return url;
}

/** @type {Provider} */
export default {
  id: 'remotli',

  detect(entry) {
    const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
    if (!raw) return null;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!HOST_RE.test(parsed.hostname)) return null;
    return { url: `${ORIGIN}${API_PATH}?page=1&limit=${PAGE_SIZE}` };
  },

  async fetch(entry, ctx) {
    // verify-portals.mjs passes maxPages:1 for its health probe — one page is
    // enough to tell a live board from a broken one.
    const cap =
      Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0
        ? ctx.maxPages
        : Number.isInteger(entry?.max_pages) && entry.max_pages > 0
          ? entry.max_pages
          : DEFAULT_MAX_PAGES;

    /** @type {any[]} */
    const out = [];
    let totalPages = 1;
    // Proof of life. Only a well-formed response sets this: a page-1 failure —
    // or a page-1 body that isn't `{ jobs: [...] }` — means we cannot tell a
    // live board from a broken one, so it must throw and surface as a dead
    // target. Once one page has parsed, the board is provably reachable and a
    // later transient failure must not discard what we already collected.
    let succeededOnce = false;

    for (let page = 1; page <= Math.min(cap, totalPages); page++) {
      const url = `${ORIGIN}${API_PATH}?page=${page}&limit=${PAGE_SIZE}`;
      assertRemotliUrl(url);

      /** @type {any[]} */
      let rows;
      try {
        // redirect:'error' prevents SSRF via server-side redirects; combined with
        // assertRemotliUrl this pins every hop to remotli.ch.
        const data = await ctx.fetchJson(url, { redirect: 'error' });

        if (!data || typeof data !== 'object' || !Array.isArray(/** @type {any} */ (data).jobs)) {
          throw new Error(
            `remotli: unexpected API response — expected { jobs: [...] }, got ${data === null ? 'null' : typeof data}`,
          );
        }

        rows = /** @type {any} */ (data).jobs;

        const reported = Number(/** @type {any} */ (data).pagination?.totalPages);
        if (Number.isInteger(reported) && reported > 0) totalPages = reported;
      } catch (err) {
        if (!succeededOnce) throw err;
        break; // keep the pages already collected — a mid-scan blip isn't a dead board
      }

      // Set only after the shape check passed, so a malformed body never counts
      // as proof of life.
      succeededOnce = true;

      for (const row of rows) {
        const job = normalizeRemotliJob(row, entry?.name);
        if (job) out.push(job);
      }

      // A short page means the board ended early — stop rather than trust the count.
      if (rows.length < PAGE_SIZE) break;
    }

    return out;
  },
};
