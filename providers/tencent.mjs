// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Tencent careers provider — hits the public careers.tencent.com JSON API.
// Zero-token, no browser needed. Verified 2026-07: GET returns structured
// JSON with title, location, BG, category, JD text and last-update time.
//
// portals.yml entry example:
//   - name: 腾讯
//     careers_url: https://careers.tencent.com/search.html   # auto-detected
//     keywords: ["AI", "大模型"]   # each keyword is queried server-side separately, results deduped;
//                                  # omit to pull the whole board (empty-keyword query)
//     max_pages: 20                # per keyword, pageSize 100 → up to 2000 posts/keyword

const API_HOST = 'careers.tencent.com';
const API_PATH = '/tencentcareer/api/post/Query';
const PAGE_SIZE = 100;
const DEFAULT_KEYWORDS = [''];  // empty keyword = the whole board, no topical bias
const DEFAULT_MAX_PAGES = 20;
// Every request after the first pays it — across pages and keyword switches
// (same idiom as avature/workday).
const INTER_PAGE_DELAY_MS = 150;

/** Parse "2026年06月23日" → epoch ms. NaN-safe. */
function parseCnDate(value) {
  if (!value) return undefined;
  const m = String(value).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return undefined;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ts) ? undefined : ts;
}

function buildUrl(keyword, pageIndex) {
  const params = new URLSearchParams({
    timestamp: String(Date.now()),
    keyword,
    pageIndex: String(pageIndex),
    pageSize: String(PAGE_SIZE),
    language: 'zh-cn',
  });
  return `https://${API_HOST}${API_PATH}?${params}`;
}

/**
 * Parse one page of the careers.tencent.com Query API payload.
 * Exported for tests.
 * @param {any} json
 * @param {string} companyName
 * @returns {{ jobs: import('./_types.js').Job[], total: number }}
 */
export function parseTencentResponse(json, companyName) {
  const posts = json?.Data?.Posts;
  const total = Number(json?.Data?.Count) || 0;
  if (!Array.isArray(posts)) return { jobs: [], total };

  const jobs = [];
  for (const p of posts) {
    const title = p.RecruitPostName || '';
    const url = p.PostURL || (p.PostId
      ? `https://careers.tencent.com/jobdesc.html?postId=${p.PostId}`
      : '');
    if (!title || !url) continue;
    jobs.push({
      title,
      url,
      company: companyName,
      location: [p.CountryName, p.LocationName].filter(Boolean).join('-'),
      description: [
        p.BGName && `BG: ${p.BGName}`,
        p.CategoryName && `类别: ${p.CategoryName}`,
        p.RequireWorkYearsName && `经验: ${p.RequireWorkYearsName}`,
        p.Responsibility,
      ].filter(Boolean).join('\n'),
      postedAt: parseCnDate(p.LastUpdateTime),
    });
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'tencent',

  detect(entry) {
    // Match the host, not a path segment, to avoid spoofed URLs.
    const url = entry.careers_url;
    if (typeof url !== 'string') return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname !== API_HOST) return null;
    return { url };
  },

  async fetch(entry, ctx) {
    const keywords = Array.isArray(entry.keywords) && entry.keywords.length
      ? entry.keywords
      : DEFAULT_KEYWORDS;
    const entryMaxPages = Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES;
    // Honor the ctx.maxPages pagination hint (verify-portals' health probe passes 1).
    const maxPages = Math.min(entryMaxPages, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    let firstRequest = true;
    let succeededOnce = false;

    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);
        let json;
        try {
          json = /** @type {any} */ (
            await ctx.fetchJson(buildUrl(keyword, page), { redirect: 'error' })
          );
        } catch (err) {
          // A dead board should still read as a failure, but a mid-run blip
          // must not discard what's already collected (same idiom as
          // workday/jobstreet/glints). Track successes directly — a keyword
          // can legitimately match 0 jobs, so seen.size is not the signal.
          if (!succeededOnce) throw err;
          console.error(`  ⚠ tencent: keyword "${keyword}" page ${page} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
          return [...seen.values()];
        }
        succeededOnce = true;
        const { jobs, total } = parseTencentResponse(json, entry.name || '腾讯');
        if (jobs.length === 0) break;

        for (const job of jobs) {
          if (!seen.has(job.url)) seen.set(job.url, job);
        }

        if (page * PAGE_SIZE >= total) break;
      }
    }

    return [...seen.values()];
  },
};
