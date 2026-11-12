// @ts-check
/**
 * lib/ats-board-url.mjs: the canonical careers URL of an ATS board, in the
 * exact shape that ATS's provider detect() reads.
 *
 * Two callers depend on these being the same functions:
 *   - discover-ats.mjs builds every probe candidate with BOARD_URL_BUILDERS,
 *     so a board it confirms is one the scanner can later read;
 *   - the employer registry (employers/) keys every row on the URL
 *     buildBoardUrl() returns, and seeds/employers-validate.mjs rejects a row
 *     whose careers_url is anything else.
 * One definition means a registry row and a discovered board cannot drift
 * apart. discover-ats.mjs re-exports buildBoardUrl and SLUG_RE.
 *
 * Dependency-free on purpose (no npm packages, no provider modules): the
 * registry's CI gate runs the validator without `npm install`, the same way
 * the plugin registry gate runs its validator.
 */

// Safe charset for a slug that will be interpolated into an ATS URL. Mixed
// case is intentional: Ashby boards are case-sensitive (AlephAlpha, DeepL).
export const SLUG_RE = /^[A-Za-z0-9._-]+$/;

const lower = (/** @type {string} */ s) => String(s).toLowerCase();

/**
 * slug → careers_url on each vendor's default host. Vendors that put the
 * company in a subdomain are matched lowercase-only by their providers, so
 * their builder lowercases the slug rather than emit a URL the provider would
 * then reject.
 * @type {Readonly<Record<string, (slug: string) => string>>}
 */
export const BOARD_URL_BUILDERS = Object.freeze({
  greenhouse:      (s) => `https://job-boards.greenhouse.io/${s}`,
  ashby:           (s) => `https://jobs.ashbyhq.com/${s}`,
  lever:           (s) => `https://jobs.lever.co/${s}`,
  workable:        (s) => `https://apply.workable.com/${s}`,
  smartrecruiters: (s) => `https://careers.smartrecruiters.com/${s}`,
  rippling:        (s) => `https://ats.rippling.com/${s}/jobs`,
  join:            (s) => `https://join.com/companies/${s}`,
  recruitee:       (s) => `https://${lower(s)}.recruitee.com`,
  breezy:          (s) => `https://${lower(s)}.breezy.hr`,
  bamboohr:        (s) => `https://${lower(s)}.bamboohr.com`,
  pinpoint:        (s) => `https://${lower(s)}.pinpointhq.com`,
});

/**
 * Vendors that host boards in more than one region. A board in the EU region
 * is a different board from a US one with the same slug, so the region is part
 * of the URL and of the registry key. `us` is the default host above.
 * @type {Readonly<Record<string, Readonly<Record<string, (slug: string) => string>>>>}
 */
export const REGIONAL_BOARD_URL_BUILDERS = Object.freeze({
  greenhouse: Object.freeze({
    us: BOARD_URL_BUILDERS.greenhouse,
    eu: (s) => `https://job-boards.eu.greenhouse.io/${s}`,
  }),
  lever: Object.freeze({
    us: BOARD_URL_BUILDERS.lever,
    eu: (s) => `https://jobs.eu.lever.co/${s}`,
  }),
});

export const REGIONS = Object.freeze(['us', 'eu']);

// Workday needs three coordinates, not a slug: tenant, instance (wdN) and site.
// The same board can be served from two host forms, so the form is recorded too:
//   jobs: https://<tenant>.<wdN>.myworkdayjobs.com/<site>
//   site: https://<wdN>.myworkdaysite.com/recruiting/<tenant>/<site>
export const WORKDAY_HOSTS = Object.freeze(['jobs', 'site']);
export const WORKDAY_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
export const WORKDAY_INSTANCE_RE = /^wd[0-9]{1,3}$/;

/** The closed list of ATS ids a registry row may name. */
export const BOARD_ATS = Object.freeze([...Object.keys(BOARD_URL_BUILDERS), 'workday']);

/**
 * Build a Workday careers URL from its coordinates.
 * @param {{tenant: string, instance: string, site: string, host?: string}} coords
 * @returns {string|null} null when a coordinate is malformed or the host form is unknown.
 */
export function workdayBoardUrl({ tenant, instance, site, host = 'jobs' }) {
  if (typeof tenant !== 'string' || !WORKDAY_SEGMENT_RE.test(tenant)) return null;
  if (typeof site !== 'string' || !WORKDAY_SEGMENT_RE.test(site)) return null;
  if (typeof instance !== 'string' || !WORKDAY_INSTANCE_RE.test(instance)) return null;
  if (host === 'jobs') return `https://${tenant}.${instance}.myworkdayjobs.com/${site}`;
  if (host === 'site') return `https://${instance}.myworkdaysite.com/recruiting/${tenant}/${site}`;
  return null;
}

/**
 * The canonical careers URL for a registry row.
 *
 * `region` is required on the regional vendors (greenhouse, lever) and must be
 * absent elsewhere; `workday_host` is required on workday and must be absent
 * elsewhere; a Workday `board` is `tenant/wdN/site`. Anything that does not fit
 * returns null rather than a URL, so a caller never probes or stores a guess.
 *
 * @param {{ats?: unknown, region?: unknown, board?: unknown, workday_host?: unknown}} row
 * @returns {string|null}
 */
export function buildBoardUrl({ ats, region, board, workday_host } = {}) {
  if (typeof ats !== 'string' || typeof board !== 'string' || !board) return null;
  if (ats === 'workday') {
    if (region !== undefined || typeof workday_host !== 'string') return null;
    const parts = board.split('/');
    if (parts.length !== 3) return null;
    const [tenant, instance, site] = parts;
    return workdayBoardUrl({ tenant, instance, site, host: workday_host });
  }
  // Own-property lookups only: a plain index would find Object.prototype keys
  // ("constructor", "toString") and call them as builders.
  if (!Object.hasOwn(BOARD_URL_BUILDERS, ats)) return null;
  if (workday_host !== undefined || !SLUG_RE.test(board)) return null;
  if (Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, ats)) {
    const byRegion = REGIONAL_BOARD_URL_BUILDERS[ats];
    if (typeof region !== 'string' || !Object.hasOwn(byRegion, region)) return null;
    return byRegion[region](board);
  }
  if (region !== undefined) return null;
  return BOARD_URL_BUILDERS[ats](board);
}
