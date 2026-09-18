// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';

// Google provider — Google Careers is server-rendered, so the results page HTML
// contains every job link:
//   GET https://www.google.com/about/careers/applications/jobs/results/?q=<kw>&location=United%20States&sort_by=date
//   -> HTML with <a href=".../jobs/results/{id}-{title-slug}">
// The title is the hyphenated slug; the public URL is the full results path.
// No JSON API and no XHR (data is in the document), so we run phrase queries and
// let scan.mjs's title filter cut. Location is not in the link → left blank.
//
// FIRST PAGE ONLY, and that is a robots.txt constraint, not an oversight.
// google.com/robots.txt disallows the paginated results URLs for every crawler:
//
//   Disallow: /about/careers/applications/jobs/results?page=
//   Disallow: /about/careers/applications/jobs/results/?page=
//   Disallow: /about/careers/applications/jobs/results?*&page=
//   Disallow: /about/careers/applications/jobs/results/?*&page=
//
// with no Allow under /about/careers that could take precedence (RFC 9309 §2.2.2
// longest-match). career-ops declines Lagou for the same reason — see
// docs/SUPPORTED_JOB_BOARDS.md: "The project does not route around that stated
// restriction." So this provider never sends `page`, which leaves one results
// page per query (~20 postings). `sort_by=date` makes that page the NEWEST
// postings, which is what a scanner run on a schedule wants; pages beyond the
// first are unreachable without the disallowed parameter, so `max_pages` does
// not apply to this provider.
//
// Config (portals.yml):
//   provider: google
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// One request per query: no `page` parameter exists in any URL this provider builds.
const LINK_RE = /jobs\/results\/(\d+)-([a-z0-9-]+)/g;
const DEFAULT_QUERIES = [
  'business strategy', 'business operations', 'strategy and operations',
  'corporate development', 'financial planning',
];

function getConfig(entry) {
  const c = entry.google || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { location: c.location || 'United States', queries };
}

function titleFromSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @type {Provider} */

export default {
  id: 'google',

  detect(entry) {
    return entry.google ? { url: BASE } : null;
  },

  async fetch(entry, ctx) {
    const { location, queries } = getConfig(entry);
    // A probe only needs to know the board answers, so it spends one query.
    const probing = Number(/** @type {any} */ (ctx)?.maxPages) > 0;
    const byId = new Map();
    for (const q of (probing ? queries.slice(0, 1) : queries)) {
      const url = `${BASE}?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&sort_by=date`;
      const html = await ctx.fetchText(url, { redirect: 'error' });
      let m;
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(html)) !== null) {
        const [, id, slug] = m;
        if (byId.has(id)) continue;
        byId.set(id, {
          title: titleFromSlug(slug),
          url: `${BASE}${id}-${slug}`,
          company: entry.name,
          location: '',
          ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
        });
      }
    }
    return [...byId.values()];
  },
};
