/** Collect feishu-jobs postings using the shared profile search terms. */
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { providerKeywords } from './_profile-keywords.mjs';
import { MACOS_BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const PAGE_SIZE = 100;
const DEFAULT_KEYWORDS = [''];
const DEFAULT_MAX_PAGES = 200;
const INTER_PAGE_DELAY_MS = 300;

/**
 * Keep host validation shared by detect() and fetch(): an explicit provider
 * selection bypasses detect(), so fetch() must enforce the same SSRF boundary.
 * @param {unknown} value
 * @returns {string|null}
 */
function resolveFeishuOrigin(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const isByteDanceOwn = url.hostname === 'jobs.bytedance.com';
  const isSharedTenant = url.hostname.endsWith('.jobs.feishu.cn');
  return isByteDanceOwn || isSharedTenant ? url.origin : null;
}

/**
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin
 * @returns {{ jobs: import('./_types.js').Job[], total: number }}
 */
export function parseFeishuJobsResponse(json, companyName, origin) {
  const list = json?.data?.job_post_list;
  const total = Number(json?.data?.count) || 0;
  if (!Array.isArray(list)) return { jobs: [], total };

  const jobs = [];
  for (const p of list) {
    const title = p?.title;
    const id = p?.id;
    if (!title || id == null) continue;
    const cities = Array.isArray(p.city_list)
      ? p.city_list.map((c) => c?.name).filter(Boolean).join('/')
      : '';
    const category = p?.job_category?.name || '';
    const recruitType = p?.recruit_type?.name || '';
    jobs.push({
      title,
      url: origin === 'https://jobs.bytedance.com'
        ? `${origin}/experienced/position/${encodeURIComponent(id)}/detail`
        : `${origin}/index/position/${encodeURIComponent(id)}/detail`,
      company: companyName,
      location: cities,
      description: [
        category && `类别: ${category}`,
        recruitType && `类型: ${recruitType}`,
        p.description,
        p.requirement,
      ].filter(Boolean).join('\n').slice(0, 4000),
      postedAt: Number.isFinite(p.publish_time) ? p.publish_time : undefined,
    });
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'feishu-jobs',

  detect(entry) {
    const origin = resolveFeishuOrigin(entry.careers_url);
    return origin ? { url: origin } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveFeishuOrigin(entry.careers_url);
    if (!origin) {
      throw new Error('feishu-jobs: careers_url must use HTTPS on jobs.bytedance.com or a *.jobs.feishu.cn tenant');
    }
    const api = `${origin}/api/v1/search/job/posts`;

    const keywords = providerKeywords(ctx);
    const entryLimit = Number(entry.max_pages);
    const probeLimit = Number(ctx?.maxPages);
    const entryMaxPages = Number.isSafeInteger(entryLimit) && entryLimit > 0
      ? entryLimit
      : DEFAULT_MAX_PAGES;
    const probeMaxPages = Number.isSafeInteger(probeLimit) && probeLimit > 0
      ? probeLimit
      : Infinity;
    const maxPages = Math.min(entryMaxPages, probeMaxPages);

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    let firstRequest = true;

    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);
        const offset = (page - 1) * PAGE_SIZE;
        let json;
        try {
          json = /** @type {any} */ (await ctx.fetchJson(api, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'accept': 'application/json',
              'user-agent': MACOS_BROWSER_LIKE_USER_AGENT,
              'referer': `${origin}/`,
            },
            body: JSON.stringify(keyword ? { limit: PAGE_SIZE, offset, keyword } : { limit: PAGE_SIZE, offset }),
            redirect: 'error',
          }));
          if (json?.code !== 0) {
            throw new Error(`API error: code=${json?.code}`);
          }
        } catch (err) {
          if (seen.size === 0) throw err;
          console.error(`  ⚠ feishu-jobs: keyword "${keyword}" page ${page} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
          return [...seen.values()];
        }
        const companyName = entry.name || origin;
        const sourcePage = Array.isArray(json?.data?.job_post_list) ? json.data.job_post_list : [];
        const { jobs, total } = parseFeishuJobsResponse(json, companyName, origin);
        if (sourcePage.length === 0) break;

        for (const job of jobs) {
          if (!seen.has(job.url)) seen.set(job.url, job);
        }

        const covered = Math.min(offset + PAGE_SIZE, total);
        if (covered >= total) break;
        if (page === maxPages && probeMaxPages > entryMaxPages) {
          console.error(`  ⚠ feishu-jobs: keyword "${keyword}" truncated at ${covered} of ${total} postings — raise max_pages for complete coverage`);
        }
      }
    }

    return [...seen.values()];
  },
};
