/**
 * Derive a stable ATS vendor label from a job or careers URL.
 *
 * Known platforms use their provider id so callers can route directly to the
 * matching scanner plugin. An otherwise-valid web URL returns its lower-cased
 * hostname instead of collapsing to "unknown": the long tail is useful signal
 * even before career-ops has a provider for it.
 */

const hostIs = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

/** @type {Array<{ id: string, test: (host: string) => boolean }>} */
export const ATS_HOST_PATTERNS = [
  { id: 'greenhouse', test: (h) => hostIs(h, 'greenhouse.io') },
  { id: 'lever', test: (h) => hostIs(h, 'lever.co') },
  { id: 'ashby', test: (h) => hostIs(h, 'ashbyhq.com') },
  { id: 'workday', test: (h) => hostIs(h, 'myworkdayjobs.com') || hostIs(h, 'myworkdaysite.com') },
  { id: 'icims', test: (h) => hostIs(h, 'icims.com') },
  { id: 'successfactors', test: (h) => hostIs(h, 'successfactors.com') || hostIs(h, 'successfactors.eu') || hostIs(h, 'jobs2web.com') },
  { id: 'dayforce', test: (h) => hostIs(h, 'dayforcehcm.com') },
  { id: 'ultipro', test: (h) => hostIs(h, 'ultipro.com') || hostIs(h, 'ultipro.ca') },
  { id: 'taleo', test: (h) => hostIs(h, 'taleo.net') },
  { id: 'bamboohr', test: (h) => hostIs(h, 'bamboohr.com') },
  { id: 'hibob', test: (h) => hostIs(h, 'careers.hibob.com') },
  { id: 'smartrecruiters', test: (h) => hostIs(h, 'smartrecruiters.com') },
  { id: 'csod', test: (h) => hostIs(h, 'csod.com') },
  { id: 'hirehive', test: (h) => hostIs(h, 'hirehive.com') },
  { id: 'talentlink', test: (h) => hostIs(h, 'recruitmentplatform.com') },
  {
    id: 'oraclecloud',
    test: (h) => /(^|\.)oraclecloud(?:[1-9]|[1-9]\d)?\.com$/.test(h),
  },
  // Each rule below copies the host check in providers/<id>.mjs. A provider
  // that reads tenants from subdomains gets a suffix match; one that pins
  // fixed hosts gets those hosts exactly, because the rest of that domain is
  // the vendor's own site (adp.com also hosts the separate adp-myjobs board).
  { id: 'adp-workforcenow', test: (h) => h === 'workforcenow.adp.com' },
  { id: 'applicantpro', test: (h) => hostIs(h, 'applicantpro.com') },
  { id: 'breezy', test: (h) => hostIs(h, 'breezy.hr') },
  { id: 'comeet', test: (h) => h === 'www.comeet.com' || h === 'www.comeet.co' },
  { id: 'gem', test: (h) => h === 'jobs.gem.com' || h === 'api.gem.com' },
  { id: 'homerun', test: (h) => hostIs(h, 'homerun.co') },
  { id: 'jazzhr', test: (h) => hostIs(h, 'applytojob.com') },
  { id: 'jobvite', test: (h) => h === 'jobs.jobvite.com' || h === 'app.jobvite.com' },
  { id: 'join', test: (h) => h === 'join.com' },
  { id: 'keka', test: (h) => hostIs(h, 'keka.com') },
  { id: 'mokahr', test: (h) => h === 'app.mokahr.com' || h === 'hire-r1.mokahr.com' },
  { id: 'paylocity', test: (h) => h === 'recruiting.paylocity.com' },
  { id: 'personio', test: (h) => hostIs(h, 'jobs.personio.de') || hostIs(h, 'jobs.personio.com') },
  { id: 'pinpoint', test: (h) => hostIs(h, 'pinpointhq.com') },
  { id: 'polymer', test: (h) => h === 'jobs.polymer.co' || h === 'api.polymer.co' },
  { id: 'prevueaps', test: (h) => hostIs(h, 'prevueaps.ca') },
  { id: 'recruitee', test: (h) => hostIs(h, 'recruitee.com') },
  { id: 'rippling', test: (h) => h === 'ats.rippling.com' },
  { id: 'schoolspring', test: (h) => hostIs(h, 'schoolspring.com') },
  { id: 'taleez', test: (h) => hostIs(h, 'taleez.com') },
  { id: 'teamtailor', test: (h) => hostIs(h, 'teamtailor.com') },
  { id: 'trakstar', test: (h) => hostIs(h, 'hire.trakstar.com') || hostIs(h, 'recruiterbox.com') },
  { id: 'turbohire', test: (h) => hostIs(h, 'turbohire.co') },
  { id: 'workable', test: (h) => h === 'apply.workable.com' },
  {
    id: 'zoho-recruit',
    test: (h) => /(^|\.)zohorecruit\.(?:com|ca|eu|in|com\.au|jp|sa|com\.cn)$/.test(h),
  },
];

export const KNOWN_ATS_VENDORS = Object.freeze(ATS_HOST_PATTERNS.map(({ id }) => id));

/**
 * @param {unknown} rawUrl
 * @returns {string|null} provider id for a known ATS, hostname for the long
 *   tail, or null when the value is not an HTTP(S) URL.
 */
export function atsVendorOf(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  return ATS_HOST_PATTERNS.find(({ test }) => test(host))?.id ?? host;
}
