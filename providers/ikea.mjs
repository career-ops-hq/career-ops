/** Collect IKEA's public job search pages for the configured China source. */

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'jobs.ikea.com';
const MAX_PAGES = 200;

function plain(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parseSearchPage(html) {
  const total = Number(html.match(/data-total-job-results="(\d+)"/)?.[1]);
  const pages = Number(html.match(/data-total-pages="(\d+)"/)?.[1]);
  if (!Number.isInteger(total) || !Number.isInteger(pages) || pages < 0) {
    throw new Error('ikea: search page has no result count');
  }
  const jobs = [];
  const starts = [...html.matchAll(/<li class="job-list__item">/g)].map((match) => match.index);
  for (let index = 0; index < starts.length; index++) {
    const block = html.slice(starts[index], starts[index + 1] ?? html.length);
    const href = block.match(/<a\s+href="([^"]+)"[^>]*class="job-list__anchor"/i)?.[1];
    const title = block.match(/<span class="job-list__title">([\s\S]*?)<\/span>/i)?.[1];
    if (!href || !title) continue;
    const url = new URL(decodeEntities(href), `https://${HOST}`);
    if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/en/job/')) continue;
    const location = block.match(/<span class="job-list__location">([\s\S]*?)<\/span>/i)?.[1] ?? '';
    jobs.push({ title: plain(title), url: url.href, location: plain(location) });
  }
  return { total, pages, jobs };
}

export default {
  id: 'ikea',
  detect(entry) {
    try {
      const url = new URL(entry.careers_url);
      return url.protocol === 'https:' && url.hostname === HOST ? { url: `https://${HOST}/en/search-jobs?l=China` } : null;
    } catch {
      return null;
    }
  },
  async fetch(entry, ctx) {
    if (!this.detect(entry)) throw new Error('ikea: invalid careers URL');
    const limit = Number.isInteger(entry.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, MAX_PAGES) : MAX_PAGES;
    const jobs = [];
    const seen = new Set();
    let pages = null;
    let expectedTotal = null;
    let gapKind = null;
    for (let page = 1; page <= limit; page++) {
      const url = `https://${HOST}/en/search-jobs?l=China&p=${page}`;
      let html;
      try {
        html = await ctx.fetchText(url, { redirect: 'error' });
      } catch (error) {
        if (!jobs.length) throw error;
        gapKind = error.status === 401 || error.status === 403 ? 'auth'
          : error.status >= 500 ? 'server' : 'network';
        break;
      }
      let result;
      try {
        result = parseSearchPage(html);
      } catch (error) {
        if (!jobs.length) throw error;
        gapKind = 'coverage_gap';
        break;
      }
      pages ??= result.pages;
      expectedTotal ??= result.total;
      if (page <= pages && result.jobs.length === 0) {
        if (!jobs.length) throw new Error(`ikea: empty page ${page} before result end`);
        gapKind = 'coverage_gap';
        break;
      }
      for (const job of result.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push({ ...job, company: entry.name });
      }
      if (page >= pages) break;
    }
    jobs.collectionTruncated = Boolean(gapKind) || pages > limit || jobs.length < expectedTotal;
    if (jobs.collectionTruncated) jobs.collectionTruncationKind = gapKind || (pages > limit ? 'page_cap' : 'coverage_gap');
    return jobs;
  },
};
