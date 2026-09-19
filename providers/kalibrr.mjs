// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Kalibrr provider — hits the public, no-auth job-board search API used by
// kalibrr.com's own front end.
//
// Kalibrr is one of the largest job boards in Indonesia and the Philippines.
// Postings resolve to identifiable employers and are free for the candidate,
// so the source clears the Source Indexing Policy.
//
// This provider is designed for explicit `provider: kalibrr` in portals.yml.
// Auto-detection from careers_url is not supported: Kalibrr is an aggregator,
// not a single company's ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — search endpoint (default: https://www.kalibrr.com/kjs/job_board/search)
//   searchKeywords  — free-text query, mapped to the `text` param (default: "")
//   country         — country filter (default: "Indonesia")
//   pageSize        — results per request, mapped to `limit` (default: 30)
//   maxPages        — maximum requests (default: 3)
//
// Deliberately NOT sent: the API also accepts a `location` param, but measured
// 2026-09-06 it does not filter — passing `location=Karawang` returned 1169
// results across Riau, Banten and Jakarta and additionally cancelled the `text`
// filter (18 results became 1169). Region narrowing belongs to portals.yml's
// `location_filter`, which reads the structured location this provider emits.

const DEFAULT_API = 'https://www.kalibrr.com/kjs/job_board/search';
const DEFAULT_COUNTRY = 'Indonesia';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;
const SITE_ORIGIN = 'https://www.kalibrr.com';

const ALLOWED_KALIBRR_HOSTS = new Set([
  'www.kalibrr.com',
  'kalibrr.com',
  'www.kalibrr.id',
  'kalibrr.id',
]);

/** @param {string} url */
function assertKalibrrUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`kalibrr: invalid api URL "${url}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`kalibrr: api URL must be https — got "${url}"`);
  }
  if (!ALLOWED_KALIBRR_HOSTS.has(parsed.hostname)) {
    throw new Error(`kalibrr: host "${parsed.hostname}" is not a Kalibrr host`);
  }
  return parsed;
}

/**
 * Strip HTML to readable text. Kalibrr returns `description` and
 * `qualifications` as HTML fragments in the list payload, so the scanner gets
 * the description for free — no extra request per job.
 *
 * @param {unknown} html
 * @returns {string}
 */
function stripHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Build the candidate-facing posting URL.
 * Measured shape: https://www.kalibrr.com/c/{company-code}/jobs/{id}/{slug}
 *
 * @param {any} item
 * @returns {string|null}
 */
function buildJobUrl(item) {
  const code = item?.company?.code || item?.company_info?.code;
  const id = item?.id;
  const slug = item?.slug;
  if (!code || !id || !slug) return null;
  return `${SITE_ORIGIN}/c/${encodeURIComponent(code)}/jobs/${encodeURIComponent(String(id))}/${encodeURIComponent(slug)}`;
}

/**
 * Kalibrr nests the location under google_location.address_components.
 * Emit "City, Region" so portals.yml `location_filter` has something to match.
 *
 * @param {any} item
 * @returns {string}
 */
function buildLocation(item) {
  if (item?.is_work_from_home) return 'Remote';
  const a = item?.google_location?.address_components;
  if (!a) return '';
  return [a.city, a.region].filter(Boolean).join(', ');
}

/**
 * @param {any} item
 * @returns {import('./_types.js').Job|null}
 */
function parseKalibrrItem(item) {
  const title = String(item?.name || '').trim();
  const url = buildJobUrl(item);
  if (!title || !url) return null;

  // A posting past its application_end_date is closed. Dropping it here keeps
  // a dead listing out of the pipeline before it costs a liveness check.
  const endRaw = item?.application_end_date;
  if (endRaw) {
    const end = Date.parse(endRaw);
    if (Number.isFinite(end) && end < Date.now()) return null;
  }

  const description = [stripHtml(item?.description), stripHtml(item?.qualifications)]
    .filter(Boolean)
    .join('\n\n');

  /** @type {import('./_types.js').Job} */
  const job = {
    title,
    url,
    company: String(item?.company_name || item?.company?.name || '').trim(),
    location: buildLocation(item),
  };

  if (description) job.description = description;

  const posted = Date.parse(item?.activation_date || item?.created_at || '');
  if (Number.isFinite(posted)) job.postedAt = posted;

  return job;
}

/** @type {Provider} */
export default {
  id: 'kalibrr',

  detect(_entry) {
    // Aggregator, not a company ATS — require an explicit provider: kalibrr.
    return null;
  },

  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertKalibrrUrl(apiUrl);

    const keywords = entry.searchKeywords || '';
    const country = entry.country || DEFAULT_COUNTRY;
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;

    /** @type {import('./_types.js').Job[]} */
    const allJobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page++) {
      const search = new URL(apiUrl);
      search.searchParams.set('limit', String(pageSize));
      search.searchParams.set('offset', String(page * pageSize));
      if (country) search.searchParams.set('country', country);
      if (keywords) search.searchParams.set('text', keywords);

      let json;
      try {
        json = /** @type {any} */ (await ctx.fetchJson(search.toString(), { redirect: 'error' }));
      } catch (err) {
        // Page 0 failing is a real error; a later page failing is not — return
        // what was collected rather than losing the whole run.
        if (page === 0) throw err;
        console.error(`kalibrr: page ${page} fetch failed — ${err.message}`);
        break;
      }

      const items = Array.isArray(json?.jobs) ? json.jobs : [];
      if (items.length === 0) break;

      for (const item of items) {
        const job = parseKalibrrItem(item);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        allJobs.push(job);
      }

      if (items.length < pageSize) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return allJobs;
  },
};
