// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Alibaba Group careers provider — posts to the public talent.alibaba.com
// JSON API (no auth, no login, no browser). Verified 2026-07 by capturing the
// site's own XHR:
//   POST /position/search
//   { "channel": "group_official_site", "language": "zh",
//     "key": "大模型", "pageIndex": 1, "pageSize": 100,
//     "batchId": "", "categories": "", "deptCodes": [], "regions": "", "subCategories": "" }
//
// The endpoint sits behind a stateless double-submit-cookie CSRF filter, not
// an auth wall: it accepts any request whose XSRF-TOKEN cookie matches the
// x-xsrf-token header, and 403s on a mismatch (verified live — a self-minted
// UUID pair is accepted, no server-side session involved). So each run mints
// one random token and sends it both ways; there is no login, cookie jar, or
// bootstrap request.
//
// portals.yml entry example:
//   - name: 阿里巴巴
//     careers_url: https://talent.alibaba.com/off-campus/position-list   # auto-detected
//     keywords: ["AI", "大模型"]   # each keyword is a separate server-side query, results deduped;
//                                  # omit to pull the whole board (~4100 postings)
//     max_pages: 50                # per keyword, pageSize 100

import { randomUUID } from 'crypto';

const API_HOST = 'talent.alibaba.com';
const API = `https://${API_HOST}/position/search`;
// Detail URL built from the numeric position id. The API's own positionUrl
// field is NOT used: it embeds a per-request track_id, which would make the
// dedup key (the URL) unstable across scans. Note the site doesn't deep-link:
// cold-navigating to a position-detail URL (this one or positionUrl alike)
// bounces to the home page, so the URL is primarily a stable identifier.
const DETAIL = `https://${API_HOST}/off-campus/position-detail?positionId=`;
const PAGE_SIZE = 100;
const DEFAULT_KEYWORDS = [''];  // empty keyword = the whole board, no topical bias
const DEFAULT_MAX_PAGES = 50;   // whole board is ~4100 postings ≈ 42 pages
// Every request after the first pays it — across pages and keyword switches
// (same idiom as avature/workday). No rate-limiting observed live, but a
// whole-board pull is 40+ requests, so pace politely.
const INTER_PAGE_DELAY_MS = 300;

/** experience is {from, to} in years; either side may be null/absent. */
function formatExperience(exp) {
  if (!exp || typeof exp !== 'object') return '';
  const from = Number.isFinite(exp.from) ? exp.from : null;
  const to = Number.isFinite(exp.to) ? exp.to : null;
  if (from != null && to != null) return `${from}-${to}年`;
  if (from != null) return `${from}年以上`;
  if (to != null) return `${to}年以下`;
  return '';
}

function buildBody(key, pageIndex) {
  return JSON.stringify({
    channel: 'group_official_site',
    language: 'zh',
    batchId: '',
    categories: '',
    deptCodes: [],
    key,
    pageIndex,
    pageSize: PAGE_SIZE,
    regions: '',
    subCategories: '',
  });
}

/**
 * Parse one page of the position/search payload.
 * Exported for tests.
 * @param {any} json
 * @param {string} companyName
 * @returns {{ jobs: import('./_types.js').Job[], total: number }}
 */
export function parseAlibabaResponse(json, companyName) {
  const list = json?.content?.datas;
  const total = Number(json?.content?.totalCount) || 0;
  if (!Array.isArray(list)) return { jobs: [], total };

  const jobs = [];
  for (const p of list) {
    const title = p.name || '';
    const id = p.id;
    if (!title || id == null) continue;
    const experience = formatExperience(p.experience);
    jobs.push({
      title,
      url: DETAIL + encodeURIComponent(id),
      company: companyName,
      location: Array.isArray(p.workLocations) ? p.workLocations.filter(Boolean).join('/') : '',
      // Alibaba posts carry full-text JDs (description + requirement), much
      // longer than other boards' summaries — cap to keep scan payloads sane.
      description: [
        Array.isArray(p.categories) && p.categories.length && `类别: ${p.categories.filter(Boolean).join('/')}`,
        experience && `经验: ${experience}`,
        p.description,
        p.requirement,
      ].filter(Boolean).join('\n').slice(0, 4000),
      postedAt: Number(p.publishTime) || Number(p.modifyTime) || undefined,
    });
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'alibaba',

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

    // One token per run, sent as both cookie and header (see file header).
    const csrfToken = randomUUID();

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
          json = /** @type {any} */ (await ctx.fetchJson(API, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'cookie': `XSRF-TOKEN=${csrfToken}`,
              'x-xsrf-token': csrfToken,
            },
            body: buildBody(keyword, page),
            redirect: 'error',
          }));
          // The API reports failures in-band with HTTP 200; surface them so a
          // dead board doesn't read as an empty-but-alive one.
          if (json?.success === false) {
            throw new Error(`API error: ${json.errorMsg || json.errorCode || 'success=false'}`);
          }
        } catch (err) {
          // A dead board should still read as a failure, but a mid-run blip
          // must not discard what's already collected (same idiom as
          // workday/jobstreet/glints). Track successes directly — a keyword
          // can legitimately match 0 jobs, so seen.size is not the signal.
          if (!succeededOnce) throw err;
          console.error(`  ⚠ alibaba: keyword "${keyword}" page ${page} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
          return [...seen.values()];
        }
        succeededOnce = true;
        const { jobs, total } = parseAlibabaResponse(json, entry.name || '阿里巴巴');
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
