// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchTextWithRetry, isRefusedRedirectError, sleep } from './_http.mjs';
import { employmentTypeField } from './_employment-type.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Wellfound provider. One source, read in two ways:
//
// 1. One company on Wellfound, for `tracked_companies:`. detect() claims
//    https://wellfound.com/company/{slug} and any deeper path (/jobs, ?page=N);
//    only the slug is read from the URL, and the provider builds the request
//    URL itself:
//
//      - name: ExampleCo
//        careers_url: https://wellfound.com/company/exampleco
//        enabled: true
//
// 2. The board, for `job_boards:`: the server-rendered search pages, reached
//    only through `provider: wellfound` plus a `wellfound:` block that narrows
//    them. The board is global (its /remote page alone runs to thousands of
//    jobs), so a block without `roles` or `locations` is refused:
//
//      - name: Wellfound (QA, Germany)
//        provider: wellfound
//        wellfound:
//          roles: [qa-engineer]       # /role/{slug}
//          locations: [germany]       # /location/{slug}
//          remote: true               # adds /role/r/{role} for each role
//          max_companies: 25          # optional, see "Board completeness"
//        enabled: true
//
//    roles x locations reads /role/l/{role}/{location}; roles alone read
//    /role/{role}; locations alone read /location/{location}. The slugs are
//    the ones in the address bar of a Wellfound search page.
//
// Both kinds of page are Next.js, server-rendered without a login. The data is
// a normalized Apollo cache in __NEXT_DATA__ (props.pageProps.apolloState.data),
// where objects point at each other with {"__ref": "Type:id"}:
//
//   company: ROOT_QUERY['startup({"slug":"…"})'] → Startup
//              .jobListingsConnection({…}) { totalPageCount, edges[].node → JobListing }
//   board:   ROOT_QUERY.talent['seoLandingPageJobSearchResults({…})']
//              { totalJobCount, pageCount, startups[] → StartupResult
//                .highlightedJobListings[] → JobListingSearchResult }
//
// Jobs are read only through those links. A company page past the last one
// answers 200 with `edges: []` while the cache still holds JobListing records
// of other companies (recommendations), so collecting every JobListing in the
// cache would return foreign jobs.
//
// Both lists paginate with ?page=N, 20 per page. A board page past
// `pageCount` answers 303 to page 1, so the walk stops at `pageCount`. A later
// page is requested with redirect: 'manual': that 303 means the list shrank
// during the walk and ends it, and any other redirect leaves the result
// partial. A later page that is not a results page does too. On page
// 1 a 303 or a 404 means a slug Wellfound does not know: an unknown role or
// location in a combined form redirects to a broader page instead of failing,
// so it is reported as a configuration error, never read as a result.
//
// Board completeness: the board groups jobs by company, 20 companies per
// page, and shows at most HIGHLIGHT_LIMIT jobs of each. When the jobs read
// from a board URL are fewer than its `totalJobCount`, the provider reads the
// company page of every company that showed HIGHLIGHT_LIMIT jobs there and
// returns all of that company's jobs; title_filter and location_filter then
// narrow them, as for a tracked company. `max_companies` bounds this step.
//
// The job URL is https://wellfound.com/jobs/{id}-{slug}, the href on the page.
// The slug is part of it: another slug, or none, answers 404. A list row has
// no URL of the employer's own ATS (`atsSource` names it, but the application
// happens on Wellfound), so the Wellfound page is the job URL.

const ORIGIN = 'https://wellfound.com';
// Company slugs can carry underscores (`sanity_io`) and end in one.
const SLUG_RE = /^[a-z0-9_-]+$/;
const JOB_ID_RE = /^[1-9][0-9]*$/;
const PAGE_SIZE = 20;
// The most jobs one company shows on a board page, observed on every board
// page checked (role, remote, role+location and location pages).
const HIGHLIGHT_LIMIT = 3;

// Company pages, 20 jobs each.
const COMPANY_DEFAULT_MAX_PAGES = 25;
const COMPANY_MAX_PAGES_CAP = 100;
// Board pages, 20 companies each. /remote, the widest page, had 215.
const BOARD_DEFAULT_MAX_PAGES = 10;
const BOARD_MAX_PAGES_CAP = 250;
const DEFAULT_MAX_COMPANIES = 25;
const MAX_COMPANIES_CAP = 100;
// Search URLs (filter combinations) per board entry; each one is walked up to
// max_pages.
const MAX_BOARD_URLS = 20;
// No Crawl-delay in robots.txt and no throttling observed.
const INTER_REQUEST_DELAY_MS = 250;

const BOARD_KEYS = new Set(['roles', 'locations', 'remote', 'max_companies']);

const CURRENCY_BY_SYMBOL = /** @type {Record<string, string>} */ ({ $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' });
const UNIT = /** @type {Record<string, number>} */ ({ k: 1_000, L: 100_000 });
// "$175k – $215k", "€80k – €100k", "₹10L – ₹20L", "$90k – $120k CAD", each
// optionally followed by " • 0.1% – 0.5%" or " • No equity". Anything else
// carries no salary.
const COMPENSATION_RE = /^([$€£₹])(\d+(?:\.\d+)?)([kL])\s*[–-]\s*\1(\d+(?:\.\d+)?)\3(?:\s+([A-Z]{3}))?(?:\s*•.*)?$/u;

/**
 * The company slug of a wellfound.com/company/{slug} URL, or null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function companySlugFromUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'wellfound.com' && host !== 'www.wellfound.com') return null;
  const slug = /^\/company\/([^/]+)(?:\/|$)/.exec(url.pathname)?.[1]?.toLowerCase();
  return slug && SLUG_RE.test(slug) ? slug : null;
}

/**
 * `listingIdentity` for a Wellfound posting: the company slug is the board,
 * the job id the posting. A board row and the same job read from its company
 * page carry the same triple.
 * @param {unknown} companySlug
 * @param {unknown} id
 * @returns {{ats_provider: 'wellfound', board_slug: string, posting_id: string} | undefined}
 */
export function wellfoundListingIdentity(companySlug, id) {
  if (typeof companySlug !== 'string' || !SLUG_RE.test(companySlug)) return undefined;
  if (typeof id !== 'string' || !JOB_ID_RE.test(id)) return undefined;
  return { ats_provider: 'wellfound', board_slug: companySlug, posting_id: id };
}

/**
 * `{min, max, currency}` from a `compensation` string, or undefined when it is
 * empty, equity only, or not a range of one known currency.
 * @param {unknown} raw
 * @returns {{min: number, max: number, currency: string} | undefined}
 */
export function parseCompensation(raw) {
  if (typeof raw !== 'string') return undefined;
  const m = COMPENSATION_RE.exec(raw.trim());
  if (!m) return undefined;
  const [, symbol, lo, unit, hi, code] = m;
  const min = Number(lo) * UNIT[unit];
  const max = Number(hi) * UNIT[unit];
  if (!(min > 0) || !(max >= min)) return undefined;
  // A trailing code names the currency the symbol leaves open ("$… CAD").
  return { min, max, currency: code || CURRENCY_BY_SYMBOL[symbol] };
}

/** @param {unknown} list @returns {string[]} */
function cleanNames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The location string and the listed places of one job.
 *
 * `locationNames` alone can mislead: a remote-only job (remoteConfig.kind
 * REMOTE) can list the company's legal seat there ("Delaware") next to the
 * regions it hires from (`acceptedRemoteLocationNames: ["Europe"]`). For such
 * a job the accepted regions are where the work is done, so they alone form
 * the location. Otherwise the places come first and a remote job adds
 * "Remote" with its accepted regions. Segments are joined with "; ", the
 * separator location_filter splits on.
 *
 * @param {any} raw  JobListing or JobListingSearchResult
 * @param {unknown} remoteKind  remoteConfig.kind
 * @returns {{location: string, locations: string[]}}
 */
export function formatLocation(raw, remoteKind) {
  const places = cleanNames(raw?.locationNames);
  const accepted = cleanNames(raw?.acceptedRemoteLocationNames);
  const remote = raw?.remote === true;
  const parts = remote && remoteKind === 'REMOTE' && accepted.length > 0 ? [] : [...places];
  if (remote) parts.push(accepted.length > 0 ? `Remote (${accepted.join(', ')})` : 'Remote');
  return { location: parts.join('; '), locations: places };
}

/**
 * `workplaceType` from `remoteConfig.kind`, when `remote` agrees with it.
 * ONSITE_OR_REMOTE lets the candidate choose either, which is not hybrid
 * work, so it has no value; neither has a kind that `remote` contradicts
 * (an ONSITE job with `remote: true` was seen).
 * @param {unknown} kind
 * @param {unknown} remote
 * @returns {'remote' | 'onsite' | undefined}
 */
export function workplaceTypeOf(kind, remote) {
  if (kind === 'REMOTE' && remote === true) return 'remote';
  if (kind === 'ONSITE' && remote !== true) return 'onsite';
  return undefined;
}

/**
 * The Apollo cache of a Wellfound page. Throws when the page carries none:
 * that is a markup change, not an empty list.
 * @param {string} html
 * @param {string} label
 * @returns {Record<string, any>}
 */
export function extractApolloState(html, label) {
  const m = typeof html === 'string'
    ? html.match(/<script\b[^>]*\sid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)
    : null;
  if (!m) throw new Error(`wellfound: ${label} has no __NEXT_DATA__ (page structure changed?)`);
  let next;
  try {
    next = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`wellfound: ${label} has unparseable __NEXT_DATA__: ${err instanceof Error ? err.message : String(err)}`);
  }
  const data = next?.props?.pageProps?.apolloState?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`wellfound: ${label} has no apolloState.data in __NEXT_DATA__ (page structure changed?)`);
  }
  return data;
}

/** Follow one {"__ref": "Type:id"} link; an inline object is returned as is. */
function deref(data, value) {
  if (value && typeof value === 'object' && typeof value.__ref === 'string') return data[value.__ref] ?? null;
  return value && typeof value === 'object' ? value : null;
}

/**
 * Map one job record to a Job, or null for a row that cannot be one.
 * @param {Record<string, any>} data  the Apollo cache, to resolve remoteConfig
 * @param {any} raw  JobListing (company page) or JobListingSearchResult (board)
 * @param {{name: string, slug: string}} company
 * @param {boolean} withDescription  board rows carry the full description
 */
function mapJob(data, raw, company, withDescription) {
  if (!raw || typeof raw !== 'object' || raw.public === false) return null;
  const id = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) ? String(raw.id) : raw.id;
  if (typeof id !== 'string' || !JOB_ID_RE.test(id)) return null;
  // Restricted to safe characters, so the slug goes into the URL as it is.
  if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const remoteKind = deref(data, raw.remoteConfig)?.kind;
  const { location, locations } = formatLocation(raw, remoteKind);
  /** @type {any} */
  const job = {
    title,
    url: `${ORIGIN}/jobs/${id}-${raw.slug}`,
    company: company.name,
    location,
    externalId: id,
  };
  if (locations.length > 0) job.locations = locations;
  const workplaceType = workplaceTypeOf(remoteKind, raw.remote);
  if (workplaceType) job.workplaceType = workplaceType;
  if (typeof raw.liveStartAt === 'number' && Number.isFinite(raw.liveStartAt) && raw.liveStartAt > 0) {
    job.postedAt = raw.liveStartAt * 1000;
  }
  // `descriptionSnippet` on a company page is a teaser, never a description.
  if (withDescription && typeof raw.description === 'string' && raw.description.trim()) {
    job.description = raw.description.trim();
  }
  const salary = parseCompensation(raw.compensation);
  if (salary) job.salary = salary;
  Object.assign(job, employmentTypeField(raw.jobType));
  const listingIdentity = wellfoundListingIdentity(company.slug, id);
  if (listingIdentity) job.listingIdentity = listingIdentity;
  return job;
}

/**
 * Parse one company jobs page.
 * @param {string} html
 * @param {string} slug  the company slug the page was requested for
 * @param {string} fallbackName  company name when the record has none
 * @returns {{name: string, liveCount: number | null, totalPageCount: number | null, rawCount: number, jobs: any[]}}
 */
export function parseCompanyPage(html, slug, fallbackName) {
  const label = `company page "${slug}"`;
  const data = extractApolloState(html, label);
  const startup = deref(data, data.ROOT_QUERY?.[`startup(${JSON.stringify({ slug })})`]);
  if (!startup) throw new Error(`wellfound: ${label} has no startup record for "${slug}" (page structure changed?)`);
  const connKeys = Object.keys(startup).filter((k) => k.startsWith('jobListingsConnection('));
  const conn = connKeys.length === 1 ? startup[connKeys[0]] : null;
  if (!conn || !Array.isArray(conn.edges)) {
    throw new Error(`wellfound: ${label} has no jobListingsConnection.edges[] (found ${connKeys.length} connections; page structure changed?)`);
  }
  const name = typeof startup.name === 'string' && startup.name.trim() ? startup.name.trim() : fallbackName;
  const company = { name, slug };
  const jobs = [];
  for (const edge of conn.edges) {
    const job = mapJob(data, deref(data, edge?.node), company, false);
    if (job) jobs.push(job);
  }
  return {
    name,
    liveCount: Number.isInteger(startup.liveJobListingsCount) ? startup.liveJobListingsCount : null,
    totalPageCount: Number.isInteger(conn.totalPageCount) ? conn.totalPageCount : null,
    rawCount: conn.edges.length,
    jobs,
  };
}

/**
 * Parse one board page.
 * @param {string} html
 * @param {string} label
 * @returns {{totalJobCount: number | null, pageCount: number | null, rawCompanies: number, rawShown: number, jobs: any[], atLimit: Array<{name: string, slug: string}>}}
 */
export function parseBoardPage(html, label) {
  const data = extractApolloState(html, label);
  const talent = data.ROOT_QUERY?.talent;
  const keys = talent && typeof talent === 'object'
    ? Object.keys(talent).filter((k) => k.startsWith('seoLandingPageJobSearchResults('))
    : [];
  const results = keys.length === 1 ? deref(data, talent[keys[0]]) : null;
  if (!results || !Array.isArray(results.startups)) {
    throw new Error(`wellfound: ${label} has no seoLandingPageJobSearchResults.startups[] (found ${keys.length} result sets; page structure changed?)`);
  }
  const jobs = [];
  const atLimit = [];
  let rawShown = 0;
  for (const ref of results.startups) {
    const startup = deref(data, ref);
    const highlighted = Array.isArray(startup?.highlightedJobListings) ? startup.highlightedJobListings : [];
    rawShown += highlighted.length;
    const slug = typeof startup?.slug === 'string' ? startup.slug : '';
    const name = typeof startup?.name === 'string' ? startup.name.trim() : '';
    if (!SLUG_RE.test(slug) || !name) continue;
    const company = { name, slug };
    if (highlighted.length >= HIGHLIGHT_LIMIT) atLimit.push(company);
    for (const jobRef of highlighted) {
      const job = mapJob(data, deref(data, jobRef), company, true);
      if (job) jobs.push(job);
    }
  }
  return {
    totalJobCount: Number.isInteger(results.totalJobCount) ? results.totalJobCount : null,
    pageCount: Number.isInteger(results.pageCount) ? results.pageCount : null,
    rawCompanies: results.startups.length,
    rawShown,
    jobs,
    atLimit,
  };
}

/** @param {unknown} v @param {string} key @param {string} name */
function slugList(v, key, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`wellfound: ${name} — wellfound.${key} must be a list of slugs`);
  const out = [];
  for (const s of v) {
    if (typeof s !== 'string' || !SLUG_RE.test(s)) {
      throw new Error(`wellfound: ${name} — wellfound.${key} has ${JSON.stringify(s)}; use the lowercase slug from the Wellfound URL (e.g. qa-engineer, germany)`);
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Validate a `wellfound:` block and list the board URLs it reads.
 * @param {any} entry
 * @returns {{urls: Array<{path: string, label: string}>, maxCompanies: number}}
 */
export function resolveBoardConfig(entry) {
  const name = entry?.name || 'Wellfound';
  const cfg = entry?.wellfound;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`wellfound: ${name} — the board needs a wellfound: block with roles and/or locations`);
  }
  for (const key of Object.keys(cfg)) {
    if (!BOARD_KEYS.has(key)) throw new Error(`wellfound: ${name} — unknown key wellfound.${key} (expected ${[...BOARD_KEYS].join(', ')})`);
  }
  const roles = slugList(cfg.roles, 'roles', name);
  const locations = slugList(cfg.locations, 'locations', name);
  if (roles.length === 0 && locations.length === 0) {
    throw new Error(`wellfound: ${name} — the Wellfound board is global; narrow it with wellfound.roles and/or wellfound.locations`);
  }
  if (cfg.remote !== undefined && typeof cfg.remote !== 'boolean') {
    throw new Error(`wellfound: ${name} — wellfound.remote must be true or false`);
  }
  if (cfg.remote === true && roles.length === 0) {
    throw new Error(`wellfound: ${name} — wellfound.remote adds /role/r/{role} pages, so it needs wellfound.roles`);
  }
  let maxCompanies = DEFAULT_MAX_COMPANIES;
  if (cfg.max_companies !== undefined) {
    if (!Number.isInteger(cfg.max_companies) || cfg.max_companies < 0) {
      throw new Error(`wellfound: ${name} — wellfound.max_companies must be a whole number, 0 or more`);
    }
    maxCompanies = Math.min(cfg.max_companies, MAX_COMPANIES_CAP);
  }

  // Config slugs are encoded once here, outside any row loop.
  const enc = (s) => encodeURIComponent(s);
  const urls = [];
  if (roles.length > 0 && locations.length > 0) {
    for (const r of roles) for (const l of locations) urls.push({ path: `/role/l/${enc(r)}/${enc(l)}`, label: `role "${r}" in location "${l}"` });
  } else if (roles.length > 0) {
    for (const r of roles) urls.push({ path: `/role/${enc(r)}`, label: `role "${r}"` });
  } else {
    for (const l of locations) urls.push({ path: `/location/${enc(l)}`, label: `location "${l}"` });
  }
  if (cfg.remote === true) {
    for (const r of roles) urls.push({ path: `/role/r/${enc(r)}`, label: `remote role "${r}"` });
  }
  if (urls.length > MAX_BOARD_URLS) {
    throw new Error(`wellfound: ${name} — ${urls.length} search URLs; at most ${MAX_BOARD_URLS} (fewer roles x locations, or split the entry)`);
  }
  return { urls, maxCompanies };
}

/** @param {any} entry @param {number} def @param {number} cap */
function resolveMaxPages(entry, def, cap) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, cap);
  return def;
}

/** @param {unknown} err */
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A page-1 failure that names a wrong slug rather than a broken source.
 * @param {unknown} err
 */
function isSlugError(err) {
  return isRefusedRedirectError(err) || /** @type {any} */ (err)?.status === 404;
}

/** @typedef {'complete' | 'cap' | 'fetch-error' | 'unrecognised-page'} StopReason */

/**
 * Whether a refused redirect on a later board page is the 303 a page past
 * the end answers: back to page 1 of the same search, with no query.
 * @param {unknown} err  a ctx.fetchText rejection under redirect: 'manual'
 * @param {string} path  the search path the page belongs to
 */
export function isPastEndRedirect(err, path) {
  const e = /** @type {any} */ (err);
  if (e?.status !== 303 || typeof e.location !== 'string') return false;
  let target;
  try {
    target = new URL(e.location, ORIGIN);
  } catch {
    return false;
  }
  return target.origin === ORIGIN && target.pathname === path && target.search === '';
}

/**
 * A configuration error for a wrong slug, keeping the HTTP status for
 * verify-portals.
 * @param {string} message
 * @param {unknown} err
 */
function slugError(message, err) {
  const how = isRefusedRedirectError(err) ? 'it redirects to another page' : errText(err);
  const e = /** @type {any} */ (new Error(`${message} (${how})`, { cause: err }));
  const status = /** @type {any} */ (err)?.status;
  if (status) e.status = status;
  return e;
}

/**
 * Walk one company's jobs pages.
 * @param {any} ctx
 * @param {() => Promise<void>} pace
 * @param {string} slug
 * @param {string} name  the entry name, for messages and as fallback company name
 * @param {number} maxPages  entry page budget
 * @param {number} ctxCap  ctx.maxPages, or Infinity
 * @returns {Promise<{jobs: any[], stopReason: StopReason, liveCount: number | null, rawTotal: number}>}
 */
async function walkCompany(ctx, pace, slug, name, maxPages, ctxCap) {
  const pages = Math.min(maxPages, ctxCap);
  const jobs = [];
  let liveCount = null;
  let rawTotal = 0;
  let lastRaw = 0;
  let total = null;
  let page = 1;
  /** @type {StopReason} */
  let stopReason = 'complete';
  for (; page <= pages; page++) {
    // The slug matches SLUG_RE (safe path characters), so it needs no encoding.
    const url = `${ORIGIN}/company/${slug}/jobs${page > 1 ? `?page=${page}` : ''}`;
    await pace();
    let html;
    try {
      html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
    } catch (err) {
      if (page === 1) {
        if (!isSlugError(err)) throw err;
        throw slugError(`wellfound: ${name} — company "${slug}" not found on Wellfound`, err);
      }
      // A probe's budget cut-off must reach verify-portals unwrapped.
      if (ctxCap !== Infinity) throw err;
      console.error(`⚠️  wellfound: ${name} — company "${slug}" truncated at page ${page} (${jobs.length} jobs): ${errText(err)}`);
      stopReason = 'fetch-error';
      break;
    }
    let parsed;
    try {
      parsed = parseCompanyPage(html, slug, name);
    } catch (err) {
      // Page 1 in that shape is a markup change; a later page in it (a
      // challenge or error page answered with 200) ends the walk with the
      // pages already read.
      if (page === 1 || ctxCap !== Infinity) throw err;
      console.error(`⚠️  wellfound: ${name} — company "${slug}" truncated at page ${page} (${jobs.length} jobs): ${errText(err)}`);
      stopReason = 'unrecognised-page';
      break;
    }
    if (page === 1) {
      liveCount = parsed.liveCount;
      total = parsed.totalPageCount;
    }
    rawTotal += parsed.rawCount;
    lastRaw = parsed.rawCount;
    jobs.push(...parsed.jobs);
    if (parsed.rawCount < PAGE_SIZE || (total !== null && page >= total)) break;
  }
  // Out of page budget on a full page with more pages reported: a cap stop.
  // Never under a probe, whose cut is not the entry's.
  if (stopReason === 'complete' && page > maxPages && ctxCap === Infinity
      && lastRaw >= PAGE_SIZE && (total === null || total > maxPages)) {
    stopReason = 'cap';
  }
  return { jobs, stopReason, liveCount, rawTotal };
}

/** The company branch: one tracked company. */
async function fetchCompany(entry, ctx, slug, pace, ctxCap) {
  const name = entry?.name || slug;
  const maxPages = resolveMaxPages(entry, COMPANY_DEFAULT_MAX_PAGES, COMPANY_MAX_PAGES_CAP);
  const { jobs, stopReason, liveCount, rawTotal } = await walkCompany(ctx, pace, slug, name, maxPages, ctxCap);
  if (stopReason === 'cap') {
    console.error(`⚠️  wellfound: ${name} truncated at max_pages=${maxPages} (${jobs.length}${liveCount !== null ? ` of ${liveCount}` : ''} jobs) — raise max_pages on this entry for more`);
    markTruncated(jobs, 'page-cap', { fetched: jobs.length, ...(liveCount !== null ? { total: liveCount } : {}) });
  } else if (stopReason !== 'complete') {
    markTruncated(jobs, stopReason, { fetched: jobs.length });
  } else if (ctxCap === Infinity && liveCount !== null && rawTotal < liveCount) {
    console.error(`⚠️  wellfound: ${name} — read ${rawTotal} of the ${liveCount} jobs the company page counts`);
  }
  return jobs;
}

/** The board branch: one filtered board entry. */
async function fetchBoard(entry, ctx, pace, ctxCap) {
  const name = entry?.name || 'Wellfound';
  const { urls, maxCompanies } = resolveBoardConfig(entry);
  const maxPages = resolveMaxPages(entry, BOARD_DEFAULT_MAX_PAGES, BOARD_MAX_PAGES_CAP);
  const probing = ctxCap !== Infinity;
  const pages = Math.min(maxPages, ctxCap);

  const jobs = [];
  const seenIds = new Set();
  const add = (job) => {
    const id = job.listingIdentity?.posting_id ?? job.url;
    if (seenIds.has(id)) return;
    seenIds.add(id);
    jobs.push(job);
  };
  /** @type {Map<string, {name: string, slug: string}>} */
  const expand = new Map();
  /** @type {string | null} */
  let partialReason = null;

  for (const { path, label } of urls) {
    let total = null;
    let pageCount = null;
    let shown = 0;
    let lastRawCompanies = 0;
    const atLimit = [];
    let page = 1;
    /** @type {StopReason} */
    let stopped = 'complete';
    for (; page <= pages; page++) {
      const url = `${ORIGIN}${path}${page > 1 ? `?page=${page}` : ''}`;
      await pace();
      let html;
      try {
        // Past page 1 the redirect is inspected, never followed: the 303 a
        // page past the end answers must be told apart from any other one.
        html = await fetchTextWithRetry(ctx, url, { redirect: page > 1 ? 'manual' : 'error' });
      } catch (err) {
        if (page === 1 && isSlugError(err)) {
          throw slugError(`wellfound: ${name} — ${path} (${label}) is not a Wellfound search page; check the slugs`, err);
        }
        // The list shrank while it was read: this page is past its end now.
        if (page > 1 && isPastEndRedirect(err, path)) break;
        if (probing || jobs.length === 0) throw err;
        console.error(`⚠️  wellfound: ${name} — ${label} truncated at page ${page} (${jobs.length} jobs so far): ${errText(err)}`);
        stopped = 'fetch-error';
        break;
      }
      let parsed;
      try {
        parsed = parseBoardPage(html, `${name} ${path}`);
      } catch (err) {
        // Page 1 in that shape is a markup change; a later page in it ends
        // the walk with the pages already read.
        if (page === 1 || probing) throw err;
        console.error(`⚠️  wellfound: ${name} — ${label} truncated at page ${page} (${jobs.length} jobs so far): ${errText(err)}`);
        stopped = 'unrecognised-page';
        break;
      }
      if (page === 1) {
        total = parsed.totalJobCount;
        pageCount = parsed.pageCount;
      }
      shown += parsed.rawShown;
      lastRawCompanies = parsed.rawCompanies;
      atLimit.push(...parsed.atLimit);
      for (const job of parsed.jobs) add(job);
      if (parsed.rawCompanies < PAGE_SIZE || (pageCount !== null && page >= pageCount)) break;
    }
    if (probing) return jobs;
    if (stopped === 'complete' && page > maxPages && lastRawCompanies >= PAGE_SIZE
        && (pageCount === null || pageCount > maxPages)) {
      stopped = 'cap';
      console.error(`⚠️  wellfound: ${name} — ${label} truncated at max_pages=${maxPages}${pageCount !== null ? ` of ${pageCount} pages` : ''} — raise max_pages on this entry, or narrow the roles and locations`);
    }
    if (stopped !== 'complete') partialReason ??= stopped === 'cap' ? 'page-cap' : stopped;
    if (total !== null && shown < total) {
      for (const c of atLimit) if (!expand.has(c.slug)) expand.set(c.slug, c);
    }
  }

  // Board completeness: read the companies the board showed at its limit.
  const companies = [...expand.values()];
  if (companies.length > maxCompanies) {
    console.error(`⚠️  wellfound: ${name} — ${companies.length} companies show ${HIGHLIGHT_LIMIT} jobs on the board; reading all jobs of the first ${maxCompanies} (raise wellfound.max_companies for more)`);
    partialReason ??= 'company-cap';
  }
  for (const company of companies.slice(0, maxCompanies)) {
    let result;
    try {
      result = await walkCompany(ctx, pace, company.slug, company.name, COMPANY_DEFAULT_MAX_PAGES, Infinity);
    } catch (err) {
      console.error(`⚠️  wellfound: ${name} — could not read all jobs of ${company.name}: ${errText(err)}`);
      partialReason ??= 'fetch-error';
      continue;
    }
    if (result.stopReason !== 'complete') partialReason ??= result.stopReason === 'cap' ? 'page-cap' : result.stopReason;
    for (const job of result.jobs) add(job);
  }

  if (partialReason) markTruncated(jobs, partialReason, { fetched: jobs.length });
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'wellfound',

  detect(entry) {
    const slug = companySlugFromUrl(entry?.careers_url) ?? companySlugFromUrl(entry?.api);
    if (slug) return { url: `${ORIGIN}/company/${slug}/jobs` };
    return entry?.provider === 'wellfound' && entry?.wellfound ? { url: ORIGIN } : null;
  },

  fetchHost() {
    return 'wellfound.com';
  },

  async fetch(entry, ctx) {
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    let requests = 0;
    const pace = async () => {
      if (requests++ > 0) await sleep(INTER_REQUEST_DELAY_MS, ctx);
    };
    if (entry?.wellfound !== undefined) return fetchBoard(entry, ctx, pace, ctxCap);
    const slug = companySlugFromUrl(entry?.careers_url) ?? companySlugFromUrl(entry?.api);
    if (!slug) {
      throw new Error(`wellfound: ${entry?.name || 'entry'} needs careers_url https://wellfound.com/company/{slug} (tracked_companies) or a wellfound: block (job_boards)`);
    }
    return fetchCompany(entry, ctx, slug, pace, ctxCap);
  },
};
