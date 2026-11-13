// @ts-check
// Surge AI's own Webflow careers inventory (not a marketplace of AI gigs).
// job_boards: provider: surge. robots checked 2026-10-28 on surgehq.ai:
// only /testing-or-archived/ and /401 excluded. One public page, no auth.
// Locations come from each card; no worldwide eligibility is inferred.
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { attr, text, assertCards } from './_scout-board.mjs';

const URL = 'https://surgehq.ai/careers';
export function parseSurgePage(html) {
  const jobs = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const path = /^\/careers\/([^/?#]+)$/.exec(attr(m[1], 'href'));
    if (!path || path[1] === '.' || path[1] === '..') continue;
    const title = text(/<[^>]*\bdata-job=["']title["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(m[2])?.[1]);
    let segment = path[1];
    try { segment = decodeURIComponent(segment); } catch { /* retain malformed escapes as literal data */ }
    if (segment === '.' || segment === '..') continue;
    const slug = safeEncodeURIComponent(segment);
    if (!title || slug === null) continue;
    const location = text(/<div\b[^>]*class=["'][^"']*\bjob-remote\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(m[2])?.[1]);
    const job = { title, url: `https://surgehq.ai/careers/${slug}`, company: 'Surge AI', location };
    jobs.set(job.url, job);
  }
  const result = [...jobs.values()];
  assertCards('surge', html, result, /href=["']\/careers\/[^"']+/i);
  return result;
}
/** @type {import('./_types.js').Provider} */
export default {
  id: 'surge',
  detect(entry) { return entry?.provider === 'surge' ? { url: URL } : null; },
  async fetch(_entry, ctx) { return parseSurgePage(await ctx.fetchText(URL, { redirect: 'error' })); },
};
