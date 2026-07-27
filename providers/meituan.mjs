// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Meituan careers provider — posts to the public zhaopin.meituan.com JSON API
// (no auth, no browser, no special headers). Verified 2026-07 by capturing the
// site's own XHR:
//   POST /api/official/job/getJobList
//   { "page": {"pageNo": N, "pageSize": 100},   ← nested pagination (a flat
//     "keywords": "大模型",                        {pageNo} is silently ignored
//     "jobShareType": "1",                         and always returns page 1)
//     "jobType": [{"code": "3", "subCode": []}], ← 3 = social hiring (社招)
//     "cityList": [], "department": [], "jfJgList": [], "typeCode": [], "specialCode": [] }
//
// portals.yml entry example:
//   - name: 美团
//     careers_url: https://zhaopin.meituan.com/web/social   # auto-detected
//     keywords: ["AI", "大模型"]   # each keyword is a separate server-side query, results deduped;
//                                  # omit to pull the whole board (~2300 postings)
//     max_pages: 30                # per keyword, pageSize 100

const API_HOST = 'zhaopin.meituan.com';
const API = `https://${API_HOST}/api/official/job/getJobList`;
const DETAIL = `https://${API_HOST}/web/position/detail?jobUnionId=`;
const PAGE_SIZE = 100;
const DEFAULT_KEYWORDS = [''];  // empty keyword = the whole board, no topical bias
const DEFAULT_MAX_PAGES = 30;
// Every request after the first pays it — across pages and keyword switches
// (same idiom as avature/workday); 400ms instead of their 150 because this
// board rate-limits harder (see EMPTY_RETRIES below).
const INTER_PAGE_DELAY_MS = 400;
// The board sporadically answers a mid-pagination request with an empty list
// (observed live; reads as rate-limiting) — retry with backoff before
// concluding a keyword is exhausted.
const EMPTY_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

function toEpochMs(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** cityList/department items are objects like {name: "北京市"} */
function names(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join('/');
}

function buildBody(keywords, pageNo) {
  return JSON.stringify({
    page: { pageNo, pageSize: PAGE_SIZE },
    keywords,
    jobShareType: '1',
    jobType: [{ code: '3', subCode: [] }],
    cityList: [], department: [], jfJgList: [], typeCode: [], specialCode: [],
  });
}

/**
 * Parse one page of the getJobList payload.
 * Exported for tests.
 * @param {any} json
 * @param {string} companyName
 * @returns {{ jobs: import('./_types.js').Job[], total: number }}
 */
export function parseMeituanResponse(json, companyName) {
  const list = json?.data?.list;
  const total = Number(json?.data?.page?.totalCount) || 0;
  if (!Array.isArray(list)) return { jobs: [], total };

  const jobs = [];
  for (const p of list) {
    const title = p.name || '';
    const id = p.jobUnionId;
    if (!title || !id) continue;
    jobs.push({
      title,
      url: DETAIL + encodeURIComponent(id),
      company: companyName,
      location: names(p.cityList),
      // Meituan posts carry full-text JDs (duty + requirements), much longer
      // than other boards' summaries — cap to keep scan payloads sane.
      description: [
        names(p.department) && `部门: ${names(p.department)}`,
        p.jobFamily && `序列: ${p.jobFamily}`,
        p.workYear && `经验: ${p.workYear}`,
        p.jobDuty,
        p.jobRequirement,
      ].filter(Boolean).join('\n').slice(0, 4000),
      postedAt: toEpochMs(p.refreshTime ?? p.firstPostTime),
    });
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'meituan',

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
      let total = 0;

      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        /** @type {import('./_types.js').Job[]|null} */
        let jobs = null;

        for (let attempt = 0; attempt <= EMPTY_RETRIES; attempt++) {
          if (firstRequest) firstRequest = false;
          else await sleep(attempt > 0 ? RETRY_BACKOFF_MS * attempt : INTER_PAGE_DELAY_MS);

          let json;
          try {
            json = await ctx.fetchJson(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: buildBody(keyword, pageNo),
              redirect: 'error',
            });
          } catch (err) {
            // A dead board should still read as a failure, but a mid-run blip
            // must not discard what's already collected (same idiom as
            // workday/jobstreet/glints). Track successes directly — a keyword
            // can legitimately match 0 jobs, so seen.size is not the signal.
            if (!succeededOnce) throw err;
            console.error(`  ⚠ meituan: keyword "${keyword}" page ${pageNo} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
            return [...seen.values()];
          }
          const parsed = parseMeituanResponse(json, entry.name || '美团');
          succeededOnce = true;
          if (parsed.total) total = parsed.total;
          if (parsed.jobs.length > 0) { jobs = parsed.jobs; break; }
          if (total && (pageNo - 1) * PAGE_SIZE >= total) break; // legitimately past the end
        }

        if (!jobs) {
          if (total && (pageNo - 1) * PAGE_SIZE < total) {
            console.error(`  ⚠ meituan: keyword "${keyword}" page ${pageNo} still empty after ${EMPTY_RETRIES} retries — keeping the ${seen.size} jobs collected so far`);
          }
          break;
        }

        for (const job of jobs) {
          if (!seen.has(job.url)) seen.set(job.url, job);
        }

        if (total && pageNo * PAGE_SIZE >= total) break;
      }
    }

    return [...seen.values()];
  },
};
