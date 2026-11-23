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
  applicantpro:    (s) => `https://${lower(s)}.applicantpro.com/jobs/`,
  hibob:           (s) => `https://${lower(s)}.careers.hibob.com/jobs`,
  hirehive:        (s) => `https://${lower(s)}.hirehive.com`,
  homerun:         (s) => `https://${lower(s)}.homerun.co`,
  jazzhr:          (s) => `https://${lower(s)}.applytojob.com/apply`,
  keka:            (s) => `https://${lower(s)}.keka.com/careers`,
  personio:        (s) => `https://${lower(s)}.jobs.personio.de`,
  prevueaps:       (s) => `https://${lower(s)}.prevueaps.ca/jobs/`,
  schoolspring:    (s) => `https://${lower(s)}.schoolspring.com`,
  taleez:          (s) => `https://${lower(s)}.taleez.com`,
  teamtailor:      (s) => `https://${lower(s)}.teamtailor.com`,
  trakstar:        (s) => `https://${lower(s)}.hire.trakstar.com`,
  turbohire:       (s) => `https://${lower(s)}.turbohire.co`,
  'zoho-recruit':  (s) => `https://${lower(s)}.zohorecruit.com/jobs/Careers`,
  avature:         (s) => `https://${lower(s)}.avature.net/careers/SearchJobs`,
  clearcompany:    (s) => `https://careers-api.clearcompany.com/v1/${lower(s)}`,
  jobvite:         (s) => `https://jobs.jobvite.com/${s}`,
  eightfold:       (s) => `https://${lower(s)}.eightfold.ai/careers`,
  'adp-myjobs':    (s) => `https://myjobs.adp.com/${s}/cx/job-listing`,
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

/**
 * Vendors whose boards live on one default host (the builder above) or on one
 * of a few other hosts. The region names the other host; it is part of the URL
 * and of the registry key, and a board on the default host has no region.
 *   - Zoho Recruit: <tenant>.zohorecruit.com by default; the region names its
 *     other data-centre domains, au for .com.au and cn for .com.cn.
 *   - Personio: <tenant>.jobs.personio.de by default (the host its provider
 *     reads a bare tenant on); com for <tenant>.jobs.personio.com.
 * @type {Readonly<Record<string, Readonly<Record<string, (slug: string) => string>>>>}
 */
export const OPTIONAL_REGION_BOARD_URL_BUILDERS = Object.freeze({
  personio: Object.freeze({
    com: (s) => `https://${lower(s)}.jobs.personio.com`,
  }),
  'zoho-recruit': Object.freeze({
    au: (s) => `https://${lower(s)}.zohorecruit.com.au/jobs/Careers`,
    ca: (s) => `https://${lower(s)}.zohorecruit.ca/jobs/Careers`,
    cn: (s) => `https://${lower(s)}.zohorecruit.com.cn/jobs/Careers`,
    eu: (s) => `https://${lower(s)}.zohorecruit.eu/jobs/Careers`,
    in: (s) => `https://${lower(s)}.zohorecruit.in/jobs/Careers`,
    jp: (s) => `https://${lower(s)}.zohorecruit.jp/jobs/Careers`,
    sa: (s) => `https://${lower(s)}.zohorecruit.sa/jobs/Careers`,
  }),
});

/**
 * The regions a row of `ats` may name: required ones for greenhouse and lever,
 * optional ones for the vendors above, none elsewhere.
 * @param {string} ats
 * @returns {readonly string[]}
 */
export function regionsOf(ats) {
  if (Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, ats)) return REGIONS;
  if (Object.hasOwn(OPTIONAL_REGION_BOARD_URL_BUILDERS, ats)) return Object.keys(OPTIONAL_REGION_BOARD_URL_BUILDERS[ats]);
  return [];
}

/** Vendors whose board id is the company's subdomain on the vendor's host. */
export const SUBDOMAIN_ATS = Object.freeze([
  'recruitee', 'breezy', 'bamboohr', 'pinpoint', 'applicantpro', 'hibob', 'hirehive', 'homerun', 'jazzhr', 'keka',
  'personio', 'prevueaps', 'schoolspring', 'taleez', 'teamtailor', 'trakstar', 'turbohire', 'zoho-recruit', 'avature', 'eightfold',
]);

/**
 * The subdomain vendors whose board id the builder and the validator check as
 * one DNS label of at most 63 characters, not one of the vendor's own
 * subdomains. recruitee, breezy, bamboohr and pinpoint, admitted first, keep
 * the rule they were admitted with.
 */
export const DNS_LABEL_ATS = Object.freeze(
  SUBDOMAIN_ATS.filter((ats) => !['recruitee', 'breezy', 'bamboohr', 'pinpoint'].includes(ats)),
);

// A ClearCompany board is its career site's id, a GUID (lowercase), on the vendor's API host: the one id
// providers/clearcompany.mjs reads.
export const CLEARCOMPANY_SITE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The first path segments on myjobs.adp.com that are its own routes, not career sites: the list in
// providers/adp-myjobs.mjs.
export const ADP_MYJOBS_RESERVED = Object.freeze(['public', 'admin', 'myadp_prefix']);

// One DNS label: letters, digits and inner hyphens, at most 63 characters.
export const SUBDOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Subdomains a vendor runs for itself, which its provider never reads as a
 * board: each list is the one in providers/<ats>.mjs. The validator and the
 * importer refuse them as board ids, and no URL is built for them.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SUBDOMAIN_RESERVED_LABELS = Object.freeze({
  applicantpro: Object.freeze(['www', 'feeds']),
  hirehive: Object.freeze(['www', 'app', 'accounts', 'apply']),
  homerun: Object.freeze(['www', 'app', 'feed', 'help', 'static', 'cdn', 'api', 'developers', 'blog', '404']),
  keka: Object.freeze(['www', 'app', 'api', 'help', 'support', 'blog', 'docs', 'status', 'mail', 'developers']),
  schoolspring: Object.freeze(['www', 'api']),
  taleez: Object.freeze(['www', 'app', 'api', 'blog', 'files', 'static', 'help', 'aide', 'status']),
  trakstar: Object.freeze(['www', 'jsapi', 'api', 'app', 'mail', 'support', 'help', 'status', 'blog', 'docs']),
  turbohire: Object.freeze(['app', 'api', 'www']),
});

/**
 * Whether `board` is a board id a subdomain vendor can serve: one DNS label
 * (any letter case; the builders lowercase it) that is not one of the vendor's
 * own subdomains.
 * @param {string} ats
 * @param {string} board
 */
export function isSubdomainBoard(ats, board) {
  const label = lower(board);
  if (!SUBDOMAIN_LABEL_RE.test(label)) return false;
  return !(Object.hasOwn(SUBDOMAIN_RESERVED_LABELS, ats) && SUBDOMAIN_RESERVED_LABELS[ats].includes(label));
}

// Workday needs three coordinates, not a slug: tenant, instance (wdN) and site.
// The same board can be served from two host forms, so the form is recorded too:
//   jobs: https://<tenant>.<wdN>.myworkdayjobs.com/<site>
//   site: https://<wdN>.myworkdaysite.com/recruiting/<tenant>/<site>
export const WORKDAY_HOSTS = Object.freeze(['jobs', 'site']);
export const WORKDAY_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
export const WORKDAY_INSTANCE_RE = /^wd[0-9]{1,3}$/;

// SuccessFactors' classic career pages need three coordinates, as providers/successfactors-classic.mjs reads them:
// the host label (career2, career5…), the domain (.eu or .com) and the company id of ?company=. The board is
// "<label>/<eu|com>/<company>", and its page https://<label>.successfactors.<eu|com>/career?company=<company>.
export const SF_CLASSIC_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const SF_CLASSIC_DOMAINS = Object.freeze(['eu', 'com']);
export const SF_CLASSIC_COMPANY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Cornerstone OnDemand career sites need three coordinates, as providers/csod.mjs reads them: the tenant's host label
// on csod.com, the career site's number and the corp name of ?c=. The board is "<tenant>/<site>/<corp>", and its page
// https://<tenant>.csod.com/ux/ats/careersite/<site>/home?c=<corp>. Reserved and test tenants are not boards.
export const CSOD_TENANT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A test tenant carries the token as a whole hyphen-separated part; a substring is not one (devon, trainline are real).
export const CSOD_TENANT_TEST_RE = /(?:^|-)(?:test|stage|staging|stg|uat|dev|sandbox|pilot|demo|train|training)(?:-|$)/;
export const CSOD_RESERVED_TENANTS = Object.freeze(['www', 'api', 'login', 'help', 'status']);
export const CSOD_SITE_RE = /^[1-9][0-9]{0,2}$/;
export const CSOD_CORP_RE = /^[A-Za-z0-9_-]{1,60}$/;

// Oracle Recruiting Cloud needs two coordinates, as providers/oraclecloud.mjs reads them: the tenant's host on
// Oracle's cloud (with its region and ocs labels and the numbered apex, as the provider's ORACLE_HOST_RE) and the
// career site's number. The board is "<host>/<siteNumber>". A tenant on a company's own domain is not admitted here.
export const ORACLECLOUD_HOST_RE = /^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud(?:[1-9][0-9]?)?\.com$/;
export const ORACLECLOUD_SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Careers sites on a company's own domain (decided by the maintainer, 2026-11-21: admitted only in the project's own
// contributions, after the ATS's mark was seen on the site). The board is the site's host, in lowercase, followed by
// a SuccessFactors brand path when there is one (one segment) or by a PeopleSoft site.
export const OWN_DOMAIN_ATS = Object.freeze(['phenom', 'successfactors', 'peoplesoft']);
/** The marks a row may record as seen on its site, per ATS. */
export const OWN_DOMAIN_MARKS = Object.freeze({
  phenom: Object.freeze(['phenompeople-assets']),
  successfactors: Object.freeze(['rmkcdn-assets', 'jobs2web']),
  peoplesoft: Object.freeze(['hrs-cg-search']),
});
// A DNS name of two labels or more, lowercase, whose last label starts with a letter (so never an IP address).
export const OWN_DOMAIN_HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const OWN_DOMAIN_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OWN_DOMAIN_LOCAL = /(?:^|\.)(?:localhost|local|internal|lan|localdomain|home\.arpa)$/;
/**
 * The domains of the systems the registry reads on their own hosts: a host under one of them is that system's board,
 * never a company's own careers site.
 */
export const VENDOR_DOMAINS = Object.freeze([
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'rippling.com', 'join.com',
  'recruitee.com', 'breezy.hr', 'bamboohr.com', 'pinpointhq.com', 'applicantpro.com', 'hibob.com', 'hirehive.com',
  'homerun.co', 'applytojob.com', 'keka.com', 'personio.de', 'personio.com', 'prevueaps.ca', 'schoolspring.com',
  'taleez.com', 'teamtailor.com', 'trakstar.com', 'recruiterbox.com', 'turbohire.co', 'zohorecruit.com',
  'zohorecruit.com.au', 'zohorecruit.ca', 'zohorecruit.com.cn', 'zohorecruit.eu', 'zohorecruit.in', 'zohorecruit.jp',
  'zohorecruit.sa', 'myworkdayjobs.com', 'myworkdaysite.com', 'avature.net', 'clearcompany.com', 'jobvite.com',
  'eightfold.ai', 'adp.com', 'successfactors.com', 'successfactors.eu', 'phenompeople.com', 'taleo.net',
  'csod.com', 'pageuppeople.com', 'ultipro.com', 'ultipro.ca', 'governmentjobs.com',
]);

/** Whether `host` is a company's own careers host: a DNS name, not local, and not under a vendor's domain. */
export function isOwnDomainHost(host) {
  if (typeof host !== 'string' || !OWN_DOMAIN_HOST_RE.test(host) || OWN_DOMAIN_LOCAL.test(host)) return false;
  if (/(?:^|\.)oraclecloud(?:[1-9][0-9]?)?\.com$/.test(host)) return false;
  return !VENDOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Build the careers URL of a site on a company's own domain.
 * @param {string} ats
 * @param {string} board
 * @returns {string|null}
 */
export function ownDomainBoardUrl(ats, board) {
  const parts = board.split('/');
  const host = parts[0];
  if (!isOwnDomainHost(host)) return null;
  if (ats === 'phenom') return parts.length === 1 ? `https://${host}` : null;
  if (ats === 'successfactors') {
    if (parts.length === 1) return `https://${host}`;
    return parts.length === 2 && OWN_DOMAIN_SEGMENT_RE.test(parts[1]) ? `https://${host}/${parts[1]}` : null;
  }
  if (ats === 'peoplesoft') {
    return parts.length === 2 && OWN_DOMAIN_SEGMENT_RE.test(parts[1])
      ? `https://${host}/psc/${parts[1]}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL` : null;
  }
  return null;
}

/** The closed list of ATS ids a registry row may name. */
export const BOARD_ATS = Object.freeze([...Object.keys(BOARD_URL_BUILDERS), 'successfactors-classic', 'oraclecloud', 'csod', ...OWN_DOMAIN_ATS, 'workday']);

/**
 * Build an Oracle Recruiting Cloud careers URL from its coordinates.
 * @param {{host: string, site: string}} coords
 * @returns {string|null} null when a coordinate is malformed.
 */
export function oraclecloudBoardUrl({ host, site }) {
  if (typeof host !== 'string' || !ORACLECLOUD_HOST_RE.test(host)) return null;
  if (typeof site !== 'string' || !ORACLECLOUD_SITE_RE.test(site)) return null;
  return `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/jobs`;
}

/**
 * Build a Cornerstone OnDemand career site URL from its coordinates.
 * @param {{tenant: string, site: string, corp: string}} coords
 * @returns {string|null} null when a coordinate is malformed, reserved or a test tenant.
 */
export function csodBoardUrl({ tenant, site, corp }) {
  if (typeof tenant !== 'string' || !CSOD_TENANT_RE.test(tenant) || CSOD_TENANT_TEST_RE.test(tenant)) return null;
  if (CSOD_RESERVED_TENANTS.includes(tenant)) return null;
  if (typeof site !== 'string' || !CSOD_SITE_RE.test(site)) return null;
  if (typeof corp !== 'string' || !CSOD_CORP_RE.test(corp)) return null;
  return `https://${tenant}.csod.com/ux/ats/careersite/${site}/home?c=${corp}`;
}

/**
 * Build a SuccessFactors classic careers URL from its coordinates.
 * @param {{label: string, domain: string, company: string}} coords
 * @returns {string|null} null when a coordinate is malformed.
 */
export function successfactorsClassicBoardUrl({ label, domain, company }) {
  if (typeof label !== 'string' || !SF_CLASSIC_LABEL_RE.test(label)) return null;
  if (!SF_CLASSIC_DOMAINS.includes(domain)) return null;
  if (typeof company !== 'string' || !SF_CLASSIC_COMPANY_RE.test(company)) return null;
  return `https://${label}.successfactors.${domain}/career?company=${company}`;
}

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
 * `region` is required on the regional vendors (greenhouse, lever), optional on
 * personio and zoho-recruit (absent on the default host) and must be absent
 * elsewhere; `workday_host` is required on workday and must be absent
 * elsewhere; a Workday `board` is `tenant/wdN/site`; a subdomain board id
 * must be a host label its vendor serves. Anything that does not fit returns
 * null rather than a URL, so a caller never probes or stores a guess. The
 * builder checks the shape of the address only: the registry's admission rules
 * (length, numeric-only ids, placeholders, letter case) are the validator's.
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
  if (OWN_DOMAIN_ATS.includes(ats)) {
    if (region !== undefined || workday_host !== undefined) return null;
    return ownDomainBoardUrl(ats, board);
  }
  if (ats === 'oraclecloud') {
    if (region !== undefined || workday_host !== undefined) return null;
    const cut = board.indexOf('/');
    if (cut < 0 || board.indexOf('/', cut + 1) >= 0) return null;
    return oraclecloudBoardUrl({ host: board.slice(0, cut), site: board.slice(cut + 1) });
  }
  if (ats === 'csod') {
    if (region !== undefined || workday_host !== undefined) return null;
    const parts = board.split('/');
    if (parts.length !== 3) return null;
    const [tenant, site, corp] = parts;
    return csodBoardUrl({ tenant, site, corp });
  }
  if (ats === 'successfactors-classic') {
    if (region !== undefined || workday_host !== undefined) return null;
    const parts = board.split('/');
    if (parts.length !== 3) return null;
    const [label, domain, company] = parts;
    return successfactorsClassicBoardUrl({ label, domain, company });
  }
  // Own-property lookups only: a plain index would find Object.prototype keys
  // ("constructor", "toString") and call them as builders.
  if (!Object.hasOwn(BOARD_URL_BUILDERS, ats)) return null;
  if (workday_host !== undefined || !SLUG_RE.test(board)) return null;
  if (DNS_LABEL_ATS.includes(ats) && !isSubdomainBoard(ats, board)) return null;
  if (ats === 'clearcompany' && !CLEARCOMPANY_SITE_RE.test(lower(board))) return null;
  if (Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, ats)) {
    const byRegion = REGIONAL_BOARD_URL_BUILDERS[ats];
    if (typeof region !== 'string' || !Object.hasOwn(byRegion, region)) return null;
    return byRegion[region](board);
  }
  if (region !== undefined && Object.hasOwn(OPTIONAL_REGION_BOARD_URL_BUILDERS, ats)) {
    const byRegion = OPTIONAL_REGION_BOARD_URL_BUILDERS[ats];
    if (typeof region !== 'string' || !Object.hasOwn(byRegion, region)) return null;
    return byRegion[region](board);
  }
  if (region !== undefined) return null;
  return BOARD_URL_BUILDERS[ats](board);
}
