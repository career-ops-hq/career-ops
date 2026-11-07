// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HireHive provider — a single-company ATS adapter for `tracked_companies:`.
// Every employer has a board at `https://<tenant>.hirehive.com/`; detect()
// claims that root and any path under it, so a posting link in either form
// (`/<title-slug>-<shortid>` or `/job/<number>/<title-slug>`) resolves to the
// board it belongs to.
//
// Data path: the board page is server-rendered HTML, and every tenant also
// serves a public, anonymous jobs API — `GET <origin>/api/v2/jobs` (no
// cookie, token or extra header) — that lists the same postings. Its envelope
// is `{ meta, links, items[] }`, and each item carries the title, the
// posting's `hosted_url`, a free-text location plus a country, the language,
// the published date and the full description, so a scan needs no per-posting
// request.
//
// Pagination: the API pages with `page` / `page_size` (`page_size` accepts at
// most 100). The walk stops when `meta.has_next_page` is false or a page holds
// fewer items than `page_size`, and never goes past `max_pages` on the entry
// (DEFAULT_MAX_PAGES when unset, MAX_PAGES_CAP at most) or `ctx.maxPages`.
// A failed page fails the whole fetch, so a partial board never reads as a
// complete one.
//
// Group boards: one tenant can list postings that live on other tenants of
// the same group; `hosted_url` then names that other `*.hirehive.com` host,
// which is the posting's real page, so it is kept as the job URL.
//
// Salary: `compensation_tiers[]` carries the pay the posting page shows. Only
// a tier whose `type` is `range_salary` or `fixed_salary` is displayed there;
// a `none` tier can still hold a figure that the page does not show and that
// can disagree with the posting text, so it is never read. Only the `year`
// interval is used, because its figures are already annual.
//
// Failure answers: an unknown tenant answers `404 {"message":"Company not
// found"}`, which reaches verify-portals as a 404 with a message that names
// the tenant. A tenant with no open roles answers 200 with an empty `items`
// array, which is an empty board. The vendor's own service hosts (see
// VENDOR_LABELS) are not boards and are never claimed.

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

export const HIREHIVE_HOST_RE = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.hirehive\.com$/;

// Labels under hirehive.com that serve the vendor's own site, login or apply
// flow rather than a tenant board: `curl -sI https://<label>.hirehive.com/`
// answers with the marketing site or a redirect to the login service.
const VENDOR_LABELS = new Set(['www', 'app', 'accounts', 'apply']);

export const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;

/**
 * The tenant label of a `<tenant>.hirehive.com` host, or null for any other
 * host and for the vendor's own service hosts.
 * @param {string} hostname
 * @returns {string | null}
 */
export function hireHiveTenantOf(hostname) {
  const m = String(hostname || '').toLowerCase().match(HIREHIVE_HOST_RE);
  if (!m || VENDOR_LABELS.has(m[1])) return null;
  return m[1];
}

/**
 * `https://<tenant>.hirehive.com`, rebuilt from the tenant label of the
 * entry's `api` or `careers_url`. The input's path, query and port are never
 * read.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveOrigin(entry) {
  const raw = [entry?.api, entry?.careers_url].find((v) => typeof v === 'string' && v.trim());
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const tenant = hireHiveTenantOf(parsed.hostname);
  return tenant ? `https://${tenant}.hirehive.com` : null;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The posting page URL from `hosted_url`, accepted only on an https
 * `<tenant>.hirehive.com` host.
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
  if (u.protocol !== 'https:' || !hireHiveTenantOf(u.hostname)) return null;
  return u.href;
}

/**
 * Location text: the employer's free-text `location`, followed by the country
 * name when the text does not already contain it, so a country-based
 * location filter can match a posting whose text names only a city.
 * @param {any} item
 * @returns {string}
 */
export function buildLocation(item) {
  const text = str(item?.location);
  const country = str(item?.country?.name);
  if (!country) return text;
  if (!text) return country;
  return text.toLowerCase().includes(country.toLowerCase()) ? text : `${text}, ${country}`;
}

const SALARY_TYPES = new Set(['range_salary', 'fixed_salary']);

/** @param {unknown} v */
function positive(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Annual salary from the first displayed yearly tier, or null.
 * @param {any} tiers
 * @returns {{min?: number, max?: number, currency?: string} | null}
 */
export function parseSalary(tiers) {
  if (!Array.isArray(tiers)) return null;
  for (const tier of tiers) {
    if (!tier || !SALARY_TYPES.has(tier.type) || tier.interval !== 'year') continue;
    const min = positive(tier.min_value);
    const max = positive(tier.max_value);
    if (min === undefined && max === undefined) continue;
    const lo = min ?? max;
    const hi = max ?? min;
    /** @type {{min?: number, max?: number, currency?: string}} */
    const salary = lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
    const currency = str(tier.currency_code).toUpperCase();
    if (currency) salary.currency = currency;
    return salary;
  }
  return null;
}

/**
 * Map one API item to a Job, or null when it lacks a title or a usable
 * posting URL.
 * @param {any} item
 * @param {string} companyName
 */
export function parseHireHiveJob(item, companyName) {
  if (!item || typeof item !== 'object') return null;
  const title = str(item.title);
  const url = postingUrl(item.hosted_url);
  if (!title || !url) return null;
  /** @type {import('./_types.js').Job} */
  const job = { title, url, company: companyName, location: buildLocation(item) };
  const postedAt = toEpochMs(item.published_date);
  if (postedAt !== undefined) job.postedAt = postedAt;
  const language = str(item.language?.code);
  if (language) job.language = language;
  const description = htmlToText(item.description?.html) || str(item.description?.text);
  if (description) job.description = description;
  const salary = parseSalary(item.compensation_tiers);
  if (salary) job.salary = salary;
  return job;
}

/**
 * Read one `/api/v2/jobs` page. Throws when the body is not the documented
 * `{ items: [] }` envelope.
 * @param {any} json
 * @param {string} companyName
 * @returns {{ jobs: import('./_types.js').Job[], rawCount: number, hasNext: boolean }}
 */
export function parseHireHivePage(json, companyName) {
  const rows = json && typeof json === 'object' && Array.isArray(json.items) ? json.items : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`hirehive: unexpected response — expected items[], got: [${got}]`);
  }
  const jobs = [];
  for (const item of rows) {
    const job = parseHireHiveJob(item, companyName);
    if (job) jobs.push(job);
  }
  return { jobs, rawCount: rows.length, hasNext: json.meta?.has_next_page !== false };
}

/** @type {Provider} */
export default {
  id: 'hirehive',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/api/v2/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) {
      throw new Error(`hirehive: no <tenant>.hirehive.com board in careers_url/api for ${entry?.name}`);
    }
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const pagesToFetch = probing ? Math.min(resolveMaxPages(entry), ctxMaxPages) : resolveMaxPages(entry);

    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    const seen = new Set();
    let stoppedAtCap = false;
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = `${origin}/api/v2/jobs?page=${page}&page_size=${PAGE_SIZE}`;
      let json;
      try {
        json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      } catch (err) {
        if (page === 1 && err?.status === 404) {
          const gone = new Error(`hirehive: ${origin} answered 404 — no such HireHive tenant`);
          /** @type {any} */ (gone).status = 404;
          throw gone;
        }
        throw err;
      }
      const parsed = parseHireHivePage(json, entry.name);
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (!parsed.hasNext || parsed.rawCount < PAGE_SIZE) break;
      if (page === pagesToFetch && !probing) stoppedAtCap = true;
    }
    if (stoppedAtCap) {
      console.warn(`hirehive: ${entry.name} has more than ${pagesToFetch * PAGE_SIZE} postings; raise max_pages on this entry`);
    }
    return jobs;
  },
};
