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
  { id: 'smartrecruiters', test: (h) => hostIs(h, 'smartrecruiters.com') },
  { id: 'csod', test: (h) => hostIs(h, 'csod.com') },
  {
    id: 'oraclecloud',
    test: (h) => /(^|\.)oraclecloud(?:[1-9]|[1-9]\d)?\.com$/.test(h),
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
