// @ts-check
// Public German IT board. Configure in job_boards with provider: get-in-it.
// Read the complete search, without job-scout's remote=true prefilter: homeOffice
// means home office is possible, not necessarily full remote.
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const ORIGIN = 'https://www.get-in-it.de';
const DEFAULT_MAX_PAGES = 10;

/** Parse the documented SSR state; a missing container is a broken page. */
export function parseGetInItPage(html) {
  const match = typeof html === 'string' && html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('get-in-it: missing __NEXT_DATA__ search state');
  let state;
  try { state = JSON.parse(match[1]).props?.initialState?.jobSearchJobs; }
  catch { throw new Error('get-in-it: invalid __NEXT_DATA__ JSON'); }
  if (!Array.isArray(state?.jobs)) throw new Error('get-in-it: expected jobSearchJobs.jobs array');
  const jobs = [];
  for (const row of state.jobs) {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || typeof row.url !== 'string') continue;
    let url;
    try {
      const u = new URL(row.url, ORIGIN);
      if (u.origin !== ORIGIN || u.username || u.password || !/^\/jobsuche\/p\d+\/?$/.test(u.pathname)) continue;
      u.search = ''; u.hash = ''; url = u.href;
    } catch { continue; }
    jobs.push({
      title: decodeEntities(row.title).trim(), url,
      company: typeof row.company?.title === 'string' ? decodeEntities(row.company.title).trim() : '',
      location: (Array.isArray(row.locations) ? row.locations : []).map(l => typeof l?.name === 'string' ? l.name : '').filter(Boolean).join(', '),
    });
  }
  return { jobs, rawCount: state.jobs.length, total: Number.isSafeInteger(state.jobsCount) ? state.jobsCount : null };
}

/** @type {import('./_types.js').Provider} */
export default {
  id: 'get-in-it',
  detect(entry) { return entry?.provider === 'get-in-it' ? { url: `${ORIGIN}/jobsuche` } : null; },
  async fetch(entry, ctx) {
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? Math.min(entry.max_pages, 100) : DEFAULT_MAX_PAGES;
    const maxPages = ctx.maxPages == null ? configured : Math.min(configured, ctx.maxPages);
    const jobs = new Map();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(600, ctx);
      const html = await fetchTextWithRetry(ctx, `${ORIGIN}/jobsuche?page=${page}`, { redirect: 'error' });
      const result = parseGetInItPage(html);
      if (!result.rawCount) break;
      const before = jobs.size;
      for (const job of result.jobs) jobs.set(job.url, job);
      if (jobs.size === before) {
        console.warn('get-in-it: page added no postings; pagination may have stopped advancing');
        break;
      }
      if (result.total !== null && jobs.size >= result.total) break;
      if (page === maxPages && ctx.maxPages == null) console.warn('get-in-it: reached max_pages; inventory may be incomplete');
    }
    return [...jobs.values()];
  },
};
