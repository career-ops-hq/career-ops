// @ts-check
// JobScout24 Switzerland (operator: JobCloud AG), job_boards:
// provider: jobscout24ch. robots checked 2026-10-28: /de/jobs/?p=N allowed;
// never reads excluded /de/apply/, /exportfeed/ or /JS24Web/ paths.
import { attr, text, boardUrl, assertCards, walkPages } from './_scout-board.mjs';

const ORIGIN = 'https://www.jobscout24.ch', URL = `${ORIGIN}/de/jobs/`;
export function parseJobscout24Page(html) {
  const jobs = [];
  const chunks = html.split(/<li\b(?=[^>]*\bclass=["'][^"']*\bjob-list-item\b)/i).slice(1);
  for (const card of chunks) {
    const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(card);
    if (!a) continue;
    const url = boardUrl(attr(a[1], 'href'), ORIGIN, /^\/de\/job\/[a-f0-9-]{36}\/?$/i);
    const title = text(a[2]);
    const attributes = /<p\b[^>]*class=["']job-attributes["'][^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1] || '';
    const fields = [...attributes.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(m => text(m[1]));
    if (!url || !title || !fields[0]) continue;
    jobs.push({ title, url, company: fields[0], location: fields.slice(1).filter(Boolean).join(' · ') });
  }
  assertCards('jobscout24ch', html, jobs, /href=["'][^"']*\/de\/job\//i);
  // The site's own next-page link also reflects its 100-page result window.
  const more = /<a\b(?=[^>]*\btitle=["']Weiter["'])(?=[^>]*\bdata-page-index=)[^>]*>/i.test(html);
  return { jobs, rawCount: chunks.length, more };
}
/** @type {import('./_types.js').Provider} */
export default {
  id: 'jobscout24ch',
  detect(entry) { return entry?.provider === 'jobscout24ch' ? { url: URL } : null; },
  async fetch(entry, ctx) {
    return walkPages({ id: 'jobscout24ch', entry, ctx, url: page => page === 1 ? URL : `${URL}?p=${page}`,
      parse: parseJobscout24Page, pageSize: 20, defaultPages: 100, hardCap: 1000 });
  },
};
