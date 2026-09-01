// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Feishu Jobs (飞书招聘, internal codename "ATSX"/"atsx-throne") careers
// provider — hits the public `/api/v1/search/job/posts` JSON endpoint that
// every tenant's own careers-site frontend calls. No login, no CSRF token,
// no signature. Verified 2026-08 by capturing live tenant sites:
//   POST /api/v1/search/job/posts
//   { "limit": N, "offset": N, "keyword": "AI" }
//
// Two tenants confirmed live: ByteDance's own site (jobs.bytedance.com) and
// a third-party tenant on the platform's shared domain (MiniMax, at
// vrfi1sk8a0.jobs.feishu.cn) — same API shape, same response schema. Any
// other company running its careers site on Feishu Jobs should work with
// the same provider; only the `careers_url` host changes per portals.yml entry.
//
// Quirks (both verified live):
//   - ByteDance's own domain (jobs.bytedance.com) runs a lightweight
//     UA-sniffing WAF rule: a macOS Chrome UA string passes (200), a Windows
//     Chrome UA on the *same* endpoint gets rejected (405) — no cookie, no
//     token involved, purely UA-string pattern matching. The third-party
//     tenant subdomain (*.jobs.feishu.cn) has no such rule. This provider
//     always sends a macOS Chrome UA + a same-origin Referer to satisfy the
//     strictest case; it is a no-op on tenants without the rule.
//   - The list payload already carries full `description` + `requirement`
//     text — no per-job detail request needed (same idiom as
//     alibaba/tencent/meituan).
//   - Detail routes differ by host class: ByteDance uses
//     `/experienced/position/{id}/detail`, while shared Feishu tenants use
//     `/index/position/{id}/detail`. Both routes cold-load the selected job and
//     expose its application control; the SPA root's `?position_id=` query does
//     not reliably select the posting.
//
// portals.yml entry example:
//   - name: 字节跳动
//     careers_url: https://jobs.bytedance.com
//     keywords: ["AI", "大模型", "Agent"]
//     max_pages: 200               # optional safety bound; pageSize 100
//
//   - name: MiniMax
//     careers_url: https://vrfi1sk8a0.jobs.feishu.cn
//     keywords: ["AI", "大模型"]
//     max_pages: 5

import { MACOS_BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const PAGE_SIZE = 100;
const DEFAULT_KEYWORDS = [''];  // empty keyword = the whole board, no topical bias
const DEFAULT_MAX_PAGES = 200;
// Every request after the first pays it — across pages and keyword switches
// (same idiom as avature/workday/alibaba).
const INTER_PAGE_DELAY_MS = 300;
// Sent unconditionally: a no-op on tenants without ByteDance's own domain's
// UA-sniffing rule, required on jobs.bytedance.com itself (see header).
// NOT the shared Windows BROWSER_LIKE_USER_AGENT from _http.mjs — that one is a
// Windows Chrome UA, and jobs.bytedance.com's rule rejects it (405, verified
// live) while accepting the shared macOS variant. The distinction is
// load-bearing, not cosmetic.

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

    const keywords = Array.isArray(entry.keywords) && entry.keywords.length
      ? entry.keywords
      : DEFAULT_KEYWORDS;
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
