// @ts-check
// DataAnnotation's public job board: one card per expertise on the home page,
// each linking to /job-board/{slug}. job_boards: provider: dataannotation.
// robots.txt checked 2026-11-07: a sitemap line only, no Disallow.
// These are standing roles (apply once, pass the qualification, then pick
// tasks), not dated postings, so no postedAt is set. The card's pay is a
// ceiling ("Up to $150+ / hr") and is stated as one. Countries are not listed
// on the board, so no eligibility is inferred.
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { attr, text, assertCards } from './_scout-board.mjs';

const ORIGIN = 'https://www.dataannotation.tech';

export function parseDataAnnotationBoard(html) {
  const jobs = new Map();
  for (const m of html.matchAll(/<a\b([^>]*\bjb-card\b[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const path = /^\/job-board\/([a-z0-9-]+)$/.exec(attr(m[1], 'href'));
    const slug = path && safeEncodeURIComponent(path[1]);
    const role = text(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(m[2])?.[1]);
    if (!slug || !role) continue;
    const domain = attr(m[1], 'data-domain').trim();
    const rate = /\$\s*([\d,.]+)(\+?)/.exec(text(/<span\b[^>]*class=["']rate["'][^>]*>([\s\S]*?)<\/span>\s*<span/i.exec(m[2])?.[1]));
    const job = {
      title: `${role} – AI Training`, url: `${ORIGIN}/job-board/${slug}`, company: 'DataAnnotation', location: 'Remote',
      description: [
        `Freelance AI-training work on DataAnnotation: ${role}${domain ? ` (${domain})` : ''}.`,
        rate && `Pay: up to $${rate[1].replace(/,/g, '')}/hour${rate[2] ? ' or more' : ''}, depending on task.`,
        'Apply once, pass the qualification assessment, then choose paid tasks.',
      ].filter(Boolean).join('\n'),
    };
    jobs.set(job.url, job);
  }
  const result = [...jobs.values()];
  assertCards('dataannotation', html, result, /href=["']\/job-board\/[a-z0-9-]+["']/i);
  return result;
}

/** @type {import('./_types.js').Provider} */
export default {
  id: 'dataannotation',
  detect(entry) { return entry?.provider === 'dataannotation' ? { url: `${ORIGIN}/` } : null; },
  async fetch(_entry, ctx) { return parseDataAnnotationBoard(await ctx.fetchText(`${ORIGIN}/`, { redirect: 'error' })); },
};
