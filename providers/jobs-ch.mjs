// @ts-check
// jobs.ch (operator: JobCloud AG), job_boards: provider: jobs-ch.
// robots checked 2026-10-28: public /de/stellenangebote/?term=&page= allowed;
// /api/ and /api_proxy/ excluded. Parse JSON state, never execute page scripts.
// Explicit queries[] scopes the search; an empty term renders no inventory.
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { str, text, epoch, walkPages } from './_scout-board.mjs';
import { sleep } from './_http.mjs';

const URL = 'https://www.jobs.ch/de/stellenangebote/';
export function parseJobsChPage(html) {
  const m = /\b__INIT__\s*=\s*([\s\S]*?);\s*__LOAD_LAZY__/.exec(html);
  if (!m) throw new Error('jobs-ch: missing __INIT__ state');
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new Error('jobs-ch: invalid __INIT__ JSON'); }
  const rows = data?.vacancy?.results?.main?.results;
  if (!Array.isArray(rows)) throw new Error('jobs-ch: expected vacancy.results.main.results[]');
  const jobs = [];
  for (const row of rows) {
    if (!row || row.isActive === false || row.company?.visible === false) continue;
    const title = text(row.title), company = text(row.company?.name), id = str(row.id);
    const seg = id && id !== '.' && id !== '..' ? safeEncodeURIComponent(id) : null;
    if (!title || !company || seg === null) continue;
    const job = { title, company, url: `https://www.jobs.ch/de/stellenangebote/detail/${seg}/`, location: text(row.place) };
    const postedAt = epoch(row.initialPublicationDate) ?? epoch(row.publicationDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return { jobs, rawCount: rows.length };
}
/** @type {import('./_types.js').Provider} */
export default {
  id: 'jobs-ch',
  detect(entry) { return entry?.provider === 'jobs-ch' ? { url: URL } : null; },
  async fetch(entry, ctx) {
    const queries = Array.isArray(entry?.queries)
      ? [...new Set(entry.queries.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim()))].slice(0, 20) : [];
    if (!queries.length) throw new Error('jobs-ch: configure at least one non-empty queries[] search term');
    const jobs = new Map();
    for (const [index, query] of queries.entries()) {
      if (index) await sleep(250, ctx);
      const rows = await walkPages({ id: 'jobs-ch', entry, ctx,
        url: page => `${URL}?${new URLSearchParams({ term: query, ...(page > 1 ? { page: String(page) } : {}) })}`,
        parse: parseJobsChPage, pageSize: 20, defaultPages: 100, hardCap: 1000 });
      for (const job of rows) jobs.set(job.url, job);
      // The one-page health check is a provider-wide request budget.
      if (ctx.maxPages != null) break;
    }
    return [...jobs.values()];
  },
};
