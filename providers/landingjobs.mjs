
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const FEED_URL = 'https://landing.jobs/api/v1/jobs';
const TRUSTED_HOST = 'landing.jobs';

/** @param {string} url */
function assertLandingUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`landingjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`landingjobs: URL must use HTTPS: ${url}`);
  }
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`landingjobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

// NaN-safe Date.parse.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Map Landing.jobs gross salary fields to Job.salary.
 * @param {any} j
 * @returns {{min: number, max: number, currency: string} | undefined}
 */
export function landingSalary(j) {
  if (!j || typeof j !== 'object') return undefined;

  /** @param {unknown} v */
  const num = (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? v
      : undefined;

  const lowValue = num(j.gross_salary_low);
  const highValue = num(j.gross_salary_high);

  if (lowValue === undefined && highValue === undefined) {
    return undefined;
  }

  const resolvedMin = lowValue ?? highValue;
  const resolvedMax = highValue ?? lowValue;
  const currency =
    typeof j.currency_code === 'string'
      ? j.currency_code.trim().toUpperCase()
      : '';

  return {
    min: Math.min(resolvedMin, resolvedMax),
    max: Math.max(resolvedMin, resolvedMax),
    currency,
  };
}

/**
 * Format a normalized Landing.jobs salary range for display.
 * @param {{min: number, max: number, currency: string} | undefined} salary
 * @returns {string}
 */
export function formatLandingSalary(salary) {
  if (
    !salary ||
    !Number.isFinite(salary.min) ||
    !Number.isFinite(salary.max) ||
    salary.min < 0 ||
    salary.max < 0 ||
    typeof salary.currency !== 'string'
  ) {
    return '';
  }

  const currency = salary.currency.trim().toUpperCase();
  if (!currency) return '';

  try {
    const formatter = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });

    const min = formatter.format(Math.min(salary.min, salary.max));
    const max = formatter.format(Math.max(salary.min, salary.max));

    return salary.min === salary.max ? min : `${min} – ${max}`;
  } catch {
    return `${Math.min(salary.min, salary.max)} – ${Math.max(salary.min, salary.max)} ${currency}`;
  }
}

/**
 * Derive company name from Landing.jobs URL.
 * @param {string} url
 */
export function companyFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (segs[0] !== 'at' || !segs[1]) return '';

  return segs[1]
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Normalize a single Landing.jobs job.
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string} } | null}
 */
export function normalizeLandingJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) {
        url = parsed.href;
      }
    } catch {
      // Invalid URL.
    }
  }

  if (!url) return null;

  const company =
    companyFromUrl(url) ||
    (typeof fallbackCompany === 'string' && fallbackCompany.trim()
      ? fallbackCompany.trim()
      : 'Landing.jobs');

  const first =
    Array.isArray(j.locations) &&
    j.locations[0] &&
    typeof j.locations[0] === 'object'
      ? j.locations[0]
      : {};

  const city = typeof first.city === 'string' ? first.city.trim() : '';
  const country =
    typeof first.country_code === 'string'
      ? first.country_code.trim()
      : '';

  const base = [city, country].filter(Boolean).join(', ');
  const location = [base, j.remote === true ? 'Remote' : '']
    .filter(Boolean)
    .join(', ');

  const job = { title, url, company, location };

  const postedAt =
    toEpochMs(j.published_at) ?? toEpochMs(j.created_at);

  if (postedAt !== undefined) job.postedAt = postedAt;

  const salary = landingSalary(j);
  if (salary !== undefined) job.salary = salary;

  return job;
}

/** @type {Provider} */
export default {
  id: 'landingjobs',

  async fetch(entry, ctx) {
    assertLandingUrl(FEED_URL);

    const json = await ctx.fetchJson(FEED_URL, {
      redirect: 'error',
    });

    if (!Array.isArray(json)) {
      throw new Error(
        `landingjobs: unexpected API response — expected a JSON array, got ${json === null ? 'null' : typeof json}`,
      );
    }

    const fallbackCompany = entry?.name;

    return json
      .map(j => normalizeLandingJob(j, fallbackCompany))
      .filter(Boolean);
  },
};
