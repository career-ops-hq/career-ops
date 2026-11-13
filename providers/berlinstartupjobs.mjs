// @ts-check
// Public RSS board, job_boards: provider: berlinstartupjobs.
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const ORIGIN = 'https://berlinstartupjobs.com';
const DEFAULT_MAX_PAGES = 20;
function tag(item, name) {
  const value = item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '';
  return decodeEntities(value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();
}

export function parseBerlinStartupJobsFeed(xml) {
  if (typeof xml !== 'string' || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) {
    throw new Error('berlinstartupjobs: expected an RSS channel');
  }
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const jobs = [];
  for (const item of items) {
    const fullTitle = tag(item, 'title');
    const split = fullTitle.lastIndexOf(' // ');
    // Never use the feed's dc:creator (a WordPress account) as the employer.
    const title = split < 0 ? fullTitle : fullTitle.slice(0, split).trim();
    const company = split < 0 ? '' : fullTitle.slice(split + 4).trim();
    if (!title) continue;
    let url;
    try {
      const u = new URL(tag(item, 'link'));
      if (u.origin !== ORIGIN || u.username || u.password || u.pathname === '/') continue;
      url = u.href;
    } catch { continue; }
    const job = { title, company, location: '', url, description: htmlToText(tag(item, 'description')) };
    const postedAt = Date.parse(tag(item, 'pubDate'));
    if (Number.isFinite(postedAt)) job.postedAt = postedAt;
    // The board includes remote and Berlin-hybrid postings; the feed does not
    // prove a specific location, so leave it unknown rather than infer Berlin.
    jobs.push(job);
  }
  return { jobs, rawCount: items.length };
}

/** @type {import('./_types.js').Provider} */
export default {
  id: 'berlinstartupjobs',
  detect(entry) { return entry?.provider === 'berlinstartupjobs' ? { url: `${ORIGIN}/feed/` } : null; },
  async fetch(entry, ctx) {
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? Math.min(entry.max_pages, 100) : DEFAULT_MAX_PAGES;
    const maxPages = ctx.maxPages == null ? configured : Math.min(configured, ctx.maxPages);
    const jobs = new Map();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(600, ctx);
      let xml;
      try {
        xml = await fetchTextWithRetry(ctx, `${ORIGIN}/feed/${page > 1 ? `?paged=${page}` : ''}`, { redirect: 'error' });
      } catch (error) {
        if (ctx.maxPages != null) throw error;
        // WordPress returns 404 after the final populated feed page.
        if (page > 1 && error.status === 404) break;
        throw error;
      }
      const result = parseBerlinStartupJobsFeed(xml);
      if (!result.rawCount) break;
      const before = jobs.size;
      for (const job of result.jobs) jobs.set(job.url, job);
      if (jobs.size === before) {
        console.warn('berlinstartupjobs: page added no postings; pagination may have stopped advancing');
        break;
      }
      if (page === maxPages && ctx.maxPages == null) console.warn('berlinstartupjobs: reached max_pages; inventory may be incomplete');
    }
    return [...jobs.values()];
  },
};
