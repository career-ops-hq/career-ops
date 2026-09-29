/** Read IBM's public careers search API; leave all job policy decisions to Python. */

import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';

const API = 'https://www-api.ibm.com/search/api/v2';
const PAGE_SIZE = 30;

export function parseIbmPage(payload) {
  const total = payload?.hits?.total;
  const rows = payload?.hits?.hits;
  if (payload?.timed_out || payload?._shards?.failed || total?.relation !== 'eq'
      || !Number.isInteger(total.value) || total.value < 0 || !Array.isArray(rows)) {
    throw new Error('ibm-careers: incomplete search response');
  }
  const jobs = rows.map(hit => {
    const source = hit?._source;
    if (typeof source?.title !== 'string' || !source.title.trim() || typeof source.url !== 'string') {
      throw new Error('ibm-careers: malformed job');
    }
    const url = new URL(source.url);
    const id = url.searchParams.get('jobId');
    if (url.protocol !== 'https:' || url.hostname !== 'careers.ibm.com' || url.username || url.password
        || url.port || url.pathname !== '/careers/JobDetail' || !/^\d+$/.test(id || '')) {
      throw new Error('ibm-careers: untrusted job URL');
    }
    const place = typeof source.field_keyword_19 === 'string' ? source.field_keyword_19 : '';
    const country = typeof source.field_keyword_05 === 'string' ? source.field_keyword_05 : '';
    return { title: decodeEntities(source.title.trim()),
      url: `https://careers.ibm.com/careers/JobDetail?jobId=${id}`,
      location: [place, country].filter(Boolean).join(', '),
      description: typeof source.description === 'string' ? decodeEntities(source.description) : '' };
  });
  return { total: total.value, jobs };
}

export default {
  id: 'ibm-careers',
  detect(entry) {
    try {
      const url = new URL(entry.careers_url);
      return url.protocol === 'https:' && url.hostname === 'www.ibm.com'
        && url.pathname === '/careers/search' ? { url: API } : null;
    } catch {
      return null;
    }
  },
  async fetch(entry, ctx) {
    if (!this.detect(entry)) throw new Error('ibm-careers: invalid careers URL');
    const limit = Number.isInteger(entry.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, 500) : 200;
    const jobs = [];
    const seen = new Set();
    let total = null;
    let pages = null;
    let gapKind = null;
    for (let page = 0; page < limit; page++) {
      if (page) await sleep(250, ctx);
      const body = { appId: 'careers', scopes: ['careers2'], query: { bool: { must: [] } },
        size: PAGE_SIZE, from: page * PAGE_SIZE, sort: [{ _id: 'asc' }],
        lang: 'zz', localeSelector: {}, sm: { query: '', lang: 'zz' },
        _source: ['title', 'url', 'description', 'field_keyword_19', 'field_keyword_05'] };
      let payload;
      try {
        payload = await fetchJsonWithRetry(ctx, API, {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json',
            referer: 'https://www.ibm.com/' }, body: JSON.stringify(body), redirect: 'error',
        }, { retries: 3 });
      } catch (error) {
        if (!jobs.length) throw error;
        gapKind = error.status === 401 || error.status === 403 ? 'auth'
          : error.status >= 500 ? 'server' : 'network';
        break;
      }
      let result;
      try {
        result = parseIbmPage(payload);
      } catch (error) {
        if (!jobs.length) throw error;
        gapKind = 'coverage_gap';
        break;
      }
      total ??= result.total;
      pages ??= Math.ceil(total / PAGE_SIZE);
      if (result.total !== total || page < pages && !result.jobs.length) {
        if (!jobs.length) throw new Error('ibm-careers: search count or page changed');
        gapKind = 'coverage_gap';
        break;
      }
      for (const job of result.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push({ ...job, company: entry.name });
      }
      if (page + 1 >= pages) break;
    }
    jobs.collectionTruncated = Boolean(gapKind) || jobs.length < total;
    if (jobs.collectionTruncated) jobs.collectionTruncationKind = gapKind || (pages > limit ? 'page_cap' : 'coverage_gap');
    return jobs;
  },
};
