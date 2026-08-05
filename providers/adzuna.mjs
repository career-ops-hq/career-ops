// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Adzuna provider — hits the public Adzuna Job Search API.
// Requires ADZUNA_APP_ID and ADZUNA_APP_KEY env vars.
//
// Free tier: 5,000 requests/month. Optimizations:
//   - Always requests 50 results/page (max) to minimize API calls
//   - Sorts by date (newest first) to stop early when results get old
//   - Throttles between requests (1s delay) to avoid rate limits
//   - Logs request count for quota visibility
//
// Config example:
//   - name: Adzuna
//     provider: adzuna
//     adzuna:
//       country: us
//       what_keywords:
//         - "AI Engineer"
//         - "LLM"
//         - "RAG"
//         - "Forward Deployed"
//       max_days_old: 1

const PAGE_SIZE = 50; // Always max — fewer API calls
const MAX_PAGES = 10;  // Safety cap per keyword — 500 jobs/keyword at 50/page
const THROTTLE_MS = 1000; // 1s between requests to avoid rate limits
const BASE_URL = 'https://api.adzuna.com/v1/api/jobs';

/** @param {number} ms */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * @param {string} keyword
 * @param {Record<string, unknown>} cfg
 * @param {number} page 0-indexed
 */
function buildUrl(keyword, cfg, page) {
  const appId = process.env.ADZUNA_APP_ID || '';
  const appKey = process.env.ADZUNA_APP_KEY || '';
  if (!appId || !appKey) throw new Error('adzuna: ADZUNA_APP_ID and ADZUNA_APP_KEY env vars required');

  const country = String(cfg.country || 'us');
  const params = new URLSearchParams();
  params.set('app_id', appId);
  params.set('app_key', appKey);
  params.set('content-type', 'application/json');
  params.set('results_per_page', String(PAGE_SIZE));
  params.set('sort_by', 'date'); // newest first — enables early stop
  params.set('what', keyword);

  if (cfg.where) params.set('where', String(cfg.where));
  if (cfg.max_days_old) params.set('max_days_old', String(cfg.max_days_old));
  if (cfg.salary_min) params.set('salary_min', String(cfg.salary_min));
  if (cfg.salary_max) params.set('salary_max', String(cfg.salary_max));

  return `${BASE_URL}/${country}/search/${page + 1}?${params.toString()}`;
}

/** @param {string} isoDate */
function toEpochMs(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return undefined;
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Split a `what` string on "OR" — Adzuna doesn't support OR syntax.
 * "AI Engineer OR LLM OR RAG" → ["AI Engineer", "LLM", "RAG"]
 * @param {unknown} what
 * @returns {string[]}
 */
function splitKeywords(what) {
  if (!what || typeof what !== 'string') return [];
  return what.split(/\s+OR\s+/i).map(k => k.trim()).filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'adzuna',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    try {
      const host = new URL(url).host.toLowerCase();
      if (host === 'adzuna.com' || host.endsWith('.adzuna.com')) return { url };
    } catch {
      /* not an absolute URL */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const jobs = [];
    const seen = new Set();
    const cfg = entry.adzuna && typeof entry.adzuna === 'object' ? entry.adzuna : {};
    const maxDaysOld = Number(cfg.max_days_old) || 1;

    // Build keyword list
    /** @type {string[]} */
    let keywords = [];
    if (Array.isArray(cfg.what_keywords)) {
      keywords = cfg.what_keywords.map(String).filter(Boolean);
    } else if (cfg.what) {
      keywords = splitKeywords(cfg.what);
    }
    if (keywords.length === 0) keywords = [''];

    const cutoffMs = maxDaysOld * 24 * 60 * 60 * 1000;
    const cutoffDate = Date.now() - cutoffMs;
    let totalRequests = 0;

    for (const keyword of keywords) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = buildUrl(keyword, cfg, page);
        const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
        totalRequests++;
        const results = Array.isArray(json?.results) ? json.results : [];
        if (results.length === 0) break;

        let fresh = 0;
        let hitOldResults = false;
        for (const j of results) {
          const postedAt = toEpochMs(j.created);
          // If sorted by date and we hit an old result, stop paginating
          if (postedAt && postedAt < cutoffDate) {
            hitOldResults = true;
            break;
          }

          const jobUrl = j.redirect_url;
          if (!jobUrl || typeof jobUrl !== 'string') continue;
          if (seen.has(jobUrl)) continue;
          seen.add(jobUrl);
          fresh++;
          jobs.push({
            title: (j.title || '').trim(),
            url: jobUrl,
            company: j.company?.display_name || entry.name,
            location: (j.location?.display_name || '').trim(),
            postedAt,
            description: (j.description || '').trim(),
          });
        }

        if (hitOldResults) break; // All remaining pages will be older
        if (fresh === 0) break;
        if (results.length < PAGE_SIZE) break; // Last page

        // Throttle between requests
        if (page < MAX_PAGES - 1 || keyword !== keywords[keywords.length - 1]) {
          await sleep(THROTTLE_MS);
        }
      }
    }

    console.log(`[Adzuna] ${jobs.length} jobs from ${totalRequests} API calls (${keywords.length} keywords × ~${Math.ceil(totalRequests / keywords.length)} pages avg)`);
    return jobs;
  },
};
