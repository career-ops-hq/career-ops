// @ts-check
// karriere.at (operator: karriere.at GmbH), job_boards: provider: karriere-at.
// Public guest XHR response used by "Weitere Jobs anzeigen"; no session.
// robots checked 2026-10-28: User-agent * has no disallow. HTML without the
// site's ordinary XHR header ignores page=N, so request the JSON view.
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { str, text, walkPages } from './_scout-board.mjs';

const URL = 'https://www.karriere.at/jobs';
export function parseKarriereAtPage(json) {
  const body = json?.data?.jobsSearchList;
  const rows = body?.activeItems?.items;
  if (!Array.isArray(rows)) throw new Error('karriere-at: expected data.jobsSearchList.activeItems.items[]');
  const jobs = [];
  for (const wrapper of rows) {
    const row = wrapper?.jobsItem;
    if (!row || row.isActive === false || row.company?.isChiffre === true) continue;
    const title = text(row.title), company = text(row.company?.name), id = str(row.id);
    const seg = id && id !== '.' && id !== '..' ? safeEncodeURIComponent(id) : null;
    if (!title || !company || seg === null) continue;
    const location = Array.isArray(row.locations) ? row.locations.map(l => text(l?.name)).filter(Boolean).join(' · ') : '';
    const description = [text(row.snippet), text(row.employmentTypes), row.isHomeOffice === true ? 'Homeoffice possible (extent unspecified)' : '', str(row.salary) && `Pay as advertised: ${str(row.salary)}`].filter(Boolean).join('\n');
    jobs.push({ title, company, url: `https://www.karriere.at/jobs/${seg}`, location, ...(description ? { description } : {}) });
  }
  return { jobs, rawCount: rows.length, more: body.loadMoreJobsButton?.active === true };
}
/** @type {import('./_types.js').Provider} */
export default {
  id: 'karriere-at',
  detect(entry) { return entry?.provider === 'karriere-at' ? { url: URL } : null; },
  async fetch(entry, ctx) {
    return walkPages({ id: 'karriere-at', entry, ctx, url: page => `${URL}?page=${page}`, parse: parseKarriereAtPage,
      json: true, headers: { 'X-Requested-With': 'XMLHttpRequest', accept: 'application/json' }, pageSize: 15, defaultPages: 100, hardCap: 1000 });
  },
};
