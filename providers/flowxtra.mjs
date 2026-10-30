// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Flowxtra provider — board-wide aggregator across every company hosted on
// Flowxtra: https://app.flowxtra.com/api/central/jobs
// Response shape: { success, data: { data: [ { title, urlJobApplay,
//   name_company, city_company, state_company, country_company, workplace,
//   date_share, ... } ], next_page_url, last_page, per_page, total, ... },
//   message }
//
// Public, no-auth, cross-tenant — one call lists live postings from every
// company using Flowxtra as its ATS, so this is a board-wide aggregator like
// arbeitnow/echojobs/thehub, not a per-company provider: scan.mjs's own
// title/location filters narrow the result afterwards.
//
// Wire in via a `job_boards:` entry with `provider: flowxtra`.

const JOBS_ENDPOINT = 'https://app.flowxtra.com/api/central/jobs';
const TRUSTED_ENDPOINT_HOST = 'app.flowxtra.com';
const TRUSTED_APPLY_HOST = 'flowxtra.com';
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;

/** @param {string} url */
function assertFlowxtraEndpointUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`flowxtra: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`flowxtra: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_ENDPOINT_HOST) {
    throw new Error(`flowxtra: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_ENDPOINT_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Normalize a single Flowxtra job row. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (rows without one are dropped).
 *   - url:      `urlJobApplay` (sic — typo in the upstream API) — the API
 *               already ships a ready-made absolute apply URL, so there is no
 *               need to build one from `has_id`. Host-locked to flowxtra.com;
 *               a non-https or off-host URL drops the row. It is the dedup
 *               key and is display-only (never server-fetched here), so the
 *               host-lock is a trust check, not an SSRF guard.
 *   - company:  `name_company`, falling back to the portal entry name, then
 *               "Flowxtra".
 *   - location: `city_company` / `state_company` / `country_company` joined
 *               (blanks dropped), with "Remote" appended when `workplace` is
 *               exactly "Remote".
 *   - postedAt: `date_share` (ISO 8601 string) → epoch ms (omitted when
 *               unparseable/absent).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeFlowxtraJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  // url: prefer the ready-made apply URL, host-locked to flowxtra.com.
  let url = '';
  const rawUrl = typeof j.urlJobApplay === 'string' ? j.urlJobApplay.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_APPLY_HOST) url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const company =
    typeof j.name_company === 'string' && j.name_company.trim()
      ? j.name_company.trim()
      : fallbackCompany || 'Flowxtra';

  const parts = [j.city_company, j.state_company, j.country_company]
    .filter(v => typeof v === 'string' && v.trim())
    .map(v => v.trim());
  const remote = j.workplace === 'Remote' ? 'Remote' : '';
  const location = [...parts, remote].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  const postedAt = toEpochMs(j.date_share);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: 'flowxtra',

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${JOBS_ENDPOINT}?status=Live&per_page=${PER_PAGE}&page=${page}`;
      assertFlowxtraEndpointUrl(url);
      // redirect:'error' prevents SSRF via server-side redirects
      const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
      const rows = json?.data?.data;
      if (!Array.isArray(rows)) {
        throw new Error(
          `flowxtra: unexpected API response on page ${page} — expected { data: { data: [...] } }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of rows) {
        const normalized = normalizeFlowxtraJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      if (!json.data.next_page_url || rows.length < PER_PAGE) break; // last page reached
    }
    return out;
  },
};
