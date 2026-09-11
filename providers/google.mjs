// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages, isProbing } from './_paging.mjs';

// Google provider — Google Careers is server-rendered, so the results page HTML
// contains every job link:
//   GET https://www.google.com/about/careers/applications/jobs/results/?q=<kw>&location=United%20States&page=<n>
//   -> HTML with <a href=".../jobs/results/{id}-{title-slug}">
// The title is the hyphenated slug; the public URL is the full results path.
// No JSON API and no XHR (data is in the document), so we run phrase queries and
// let scan.mjs's title filter cut. Location is not in the link → left blank.
//
// Config (portals.yml):
//   provider: google
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
const PAGE_CAP = 4;            // results pages per query (≈20 jobs/page)
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
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { location, queries } = getConfig(entry);
    const byId = new Map();
    for (const q of (isProbing(ctx) ? queries.slice(0, 1) : queries)) {
      for (let page = 1; page <= pageCap; page++) {
        const url = `${BASE}?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&page=${page}`;
        const html = await ctx.fetchText(url, { redirect: 'error' });
        let m, before = byId.size;
        LINK_RE.lastIndex = 0;
        while ((m = LINK_RE.exec(html)) !== null) {
          const [, id, slug] = m;
          if (byId.has(id)) continue;
          byId.set(id, {
            title: titleFromSlug(slug),
            url: `${BASE}${id}-${slug}`,
            company: entry.name,
            location: '',
          });
        }
        if (byId.size === before) break;  // no new links on this page — end query
      }
    }
    return [...byId.values()];
  },
};
