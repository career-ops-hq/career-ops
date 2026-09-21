// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// YER provider — public job-list API at https://www.yer.de/de/api/jobs.
// The response is { jobs: [...] } with ten jobs per offset page. List items
// identify neither the underlying client company nor a per-job remote model, so
// the normalized company deliberately remains the source label "YER" and no
// unsupported location qualifiers are synthesized.

const API_URL = 'https://www.yer.de/de/api/jobs?recommendations=0';
const TRUSTED_HOST = 'www.yer.de';
const POSTING_PATH = '/de/jobangebote/';
const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 100;

/** @param {object} entry @param {object} [ctx] */
function resolveMaxPages(entry, ctx) {
  const configured = entry?.max_pages;
  const entryLimit = Number.isInteger(configured) && configured > 0
    ? Math.min(configured, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
  const probeLimit = ctx?.maxPages;
  return Number.isInteger(probeLimit) && probeLimit > 0 ? Math.min(entryLimit, probeLimit) : entryLimit;
}

/**
 * Normalize one YER list row into the scanner's Job shape.
 *
 * @param {any} row
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
export function normalizeYerJob(row, fallbackCompany = 'YER') {
  if (!row || typeof row !== 'object') return null;
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!title) return null;

  const rawUrl = typeof row.urlAbsolute === 'string' && row.urlAbsolute.trim()
    ? row.urlAbsolute.trim()
    : typeof row.url === 'string' ? row.url.trim() : '';
  if (!rawUrl) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl, `https://${TRUSTED_HOST}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== TRUSTED_HOST || !parsed.pathname.startsWith(POSTING_PATH)) return null;

  const location = typeof row.location === 'string' && row.location.trim()
    ? row.location.trim()
    : typeof row.workplace === 'string' ? row.workplace.trim() : '';
  return {
    title,
    url: `${parsed.origin}${parsed.pathname}${parsed.search}`,
    company: fallbackCompany || 'YER',
    location,
  };
}

/** @type {Provider} */
export default {
  id: 'yer',

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry, ctx);
    const jobs = [];
    const seenUrls = new Set();

    for (let offset = 0; offset < maxPages; offset++) {
      const url = new URL(API_URL);
      url.searchParams.set('offset', String(offset));
      const response = await ctx.fetchJson(url.href, { redirect: 'error' });
      if (!response || !Array.isArray(response.jobs)) {
        throw new Error(`yer: unexpected API response on offset ${offset} — expected { jobs: [...] }`);
      }
      for (const row of response.jobs) {
        const job = normalizeYerJob(row, entry?.name || 'YER');
        if (job && !seenUrls.has(job.url)) {
          seenUrls.add(job.url);
          jobs.push(job);
        }
      }
      if (response.jobs.length < PAGE_SIZE) break;
    }
    return jobs;
  },
};
