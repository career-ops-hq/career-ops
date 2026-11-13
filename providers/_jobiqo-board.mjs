// @ts-check
// Shared Jobiqo SSR shape, used only by fixed-host, explicit board adapters.
import { str, text, epoch, httpsUrl, boardUrl, nextData, walkPages } from './_scout-board.mjs';

export function parseJobiqoPage(html, origin, id) {
  const body = nextData(html, id)?.props?.pageProps?.data?.jobs;
  if (!Array.isArray(body?.pages)) throw new Error(`${id}: expected props.pageProps.data.jobs.pages[]`);
  const jobs = [];
  for (const row of body.pages) {
    if (!row || typeof row !== 'object') continue;
    const title = text(row.title), company = text(row.organization);
    // Blank organisation names remain unknown: never turn the board into
    // the employer or infer one from a logo, slug or imported HTML filename.
    const fallback = boardUrl(row.url?.path, origin, /^\/job\/[a-z0-9-]+-\d+\/?$/i);
    const url = httpsUrl(row.linkUrl) || httpsUrl(row.absoluteUrl) || fallback;
    if (!title || !company || !url) continue;
    const location = Array.isArray(row.address) ? row.address.map(text).filter(Boolean).join(' · ') : '';
    const remote = Array.isArray(row.remoteOptions) ? row.remoteOptions.map(r => text(r?.label)).filter(Boolean).join(', ') : '';
    const job = { title, company, url, location: [location, remote].filter(Boolean).join(' · ') };
    const postedAt = epoch(row.published);
    if (postedAt !== undefined) job.postedAt = postedAt;
    if (str(row.description)) job.description = text(row.description);
    jobs.push(job);
  }
  // Both boards serve ten rows/page; result_count is advisory, not a stop.
  return { jobs, rawCount: body.pages.length };
}
export function jobiqoBoard(id, origin) {
  const url = `${origin}/jobs`;
  return {
    id,
    detect(entry) { return entry?.provider === id ? { url } : null; },
    async fetch(entry, ctx) {
      return walkPages({ id, entry, ctx, url: page => page === 1 ? url : `${url}?page=${page}`,
        parse: html => parseJobiqoPage(html, origin, id), pageSize: 10, defaultPages: 100, hardCap: 1000, delayMs: 10_000 });
    },
  };
}
