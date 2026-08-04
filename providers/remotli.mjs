// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Remotli provider — remotli.ch, a curated board of remote roles at Swiss
// companies (paid in CHF). Public JSON API, no auth:
//
//   https://remotli.ch/api/jobs?page=N&limit=50&remote=all
//   → { jobs: [ { jobs: {...}, companies: {...} }, ... ],
//       pagination: { page, limit, total, totalPages } }
//
// `remote=all` is required for full coverage — without it the API serves its
// remote-first default view, which is ~43% of the board. See ALL_WORK_MODES.
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
// URL / dedup key. Each posting carries its `applyUrl` — the original ATS page
// (Greenhouse, Ashby, Lever, Personio, …) — as the emitted URL, per the Source
// Indexing Policy rule 2: the shortest verifiable path to the employer. The
// board's own page is the fallback, used only when a row has no usable
// applyUrl.
//
// Following jobvite.mjs, the emitted URL is accepted from any https: origin and
// is NOT host-pinned: it is display-only and never fetched by this provider, so
// the host lock belongs on the API URLs we actually request (assertRemotliUrl),
// not on the URLs we hand downstream. Non-https and malformed applyUrls fall
// back to the board page rather than being trusted.
//
// Side benefit for dedup: a role cross-listed here and on the employer's direct
// ATS provider now resolves to the same URL, so it dedups exactly rather than
// relying on the #1597 SimHash fingerprint to notice. The fingerprint still
// works — this API ships the full `description` for free — but it is no longer
// the only thing standing between a cross-listing and a duplicate row.
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
// `remote=all` disables the board's work-mode filter so we walk its COMPLETE
// inventory — Source Indexing Policy rule 3.
//
// Without it the API serves its human-facing default view, which is remote-first
// (fully_remote + remote_friendly) and shows 395 of 925 active listings — about
// 43%. The hidden 530 are hybrid (488), workation (41) and one row carrying no
// work-mode at all.
//
// Naming the four filter values explicitly would very nearly work, but not
// quite: it returns 924, missing the policy-less row, and it would go stale the
// next time the board adds a work mode — the same drift that has bitten that
// board's own hardcoded copies of this list before. The board therefore added a
// single flag that means "no work-mode filter", which is stable against both.
//
// Filtering is the consumer's job (rule 5), so the provider takes everything and
// lets scan.mjs's content/location filters decide.
const ALL_WORK_MODES = 'remote=all';
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

/**
 * Canonical URL for a posting — Source Indexing Policy rule 2, "the shortest
 * verifiable path to the employer the source exposes".
 *
 * Prefers `applyUrl` (the employer's own ATS page). Accepts any https: origin,
 * as jobvite.mjs does: the value is display-only and never fetched here, so the
 * host lock stays on the API URLs this provider requests, not on the ones it
 * emits. Falls back to the board page when applyUrl is absent, non-https or
 * malformed — the policy says "when available", and a verifiable board page
 * beats dropping a real posting. Returns '' when neither is usable, and the
 * caller drops the row.
 *
 * @param {any} job
 * @param {string} safeSlug Already validated as path-safe, or '' if it was not.
 */
function resolveUrl(job, safeSlug) {
  const raw = typeof job.applyUrl === 'string' ? job.applyUrl.trim() : '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') return parsed.href;
    } catch {
      // malformed — fall through to the board page
    }
  }
  return safeSlug ? `${ORIGIN}/jobs/${safeSlug}` : '';
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
  //
  // Fail closed: anything that is not exactly `active` is rejected, including a
  // missing or non-string status. An earlier revision let an absent status
  // through, which made the "only active rows are emitted" guarantee depend on
  // the API always sending the field. It does today — /api/jobs filters
  // `status = 'active'` in SQL, so all 395 live rows carry it — but the provider
  // cannot see that invariant, and the two failure modes are not symmetric: a
  // dropped field would silently publish closed roles as dead links, whereas
  // rejecting unknown status yields a visibly empty board that the
  // verify-portals health probe surfaces.
  const status = typeof job.status === 'string' ? job.status.trim().toLowerCase() : '';
  if (status !== 'active') return null;

  // Canonical URL: the employer's own application page when the row exposes a
  // usable one, else the board page. The slug is validated only on the fallback
  // path, because that is the only place it gets interpolated into a URL — a
  // row with an unsafe slug but a good applyUrl is still emitted, and the unsafe
  // slug is simply never used.
  const slug = typeof job.slug === 'string' ? job.slug.trim() : '';
  const safeSlug = slug && !/[^a-z0-9._~-]/i.test(slug) ? slug : '';
  const url = resolveUrl(job, safeSlug);
  if (!url) return null;

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
    return { url: `${ORIGIN}${API_PATH}?page=1&limit=${PAGE_SIZE}&${ALL_WORK_MODES}` };
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
      const url = `${ORIGIN}${API_PATH}?page=${page}&limit=${PAGE_SIZE}&${ALL_WORK_MODES}`;
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
