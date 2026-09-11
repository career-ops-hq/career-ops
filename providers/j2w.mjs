// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages, isProbing } from './_paging.mjs';

// j2w provider — SAP SuccessFactors "Jobs2Web" (RMK) career sites render search
// results as SSR HTML, paginated by ?startrow=N (25/page). Job links look like:
//   https://{host}/job/{City-Title-State-Zip-slug}/{id}/
// The keyword query (?q=) DOES filter server-side. Title+location are embedded in
// the slug (URL-encoded). Used by Paramount (careers.paramount.com) and Lionsgate
// (jobs.lionsgate.com).
//
// Config (portals.yml):
//   provider: j2w
//   j2w:
//     host: careers.paramount.com
//     queries: ["strategy", "business operations", ...]

const PAGE_STEP = 25;
const PAGE_CAP = 4;            // ≤100 results per query — bounded
// Matches both /job/{slug}/{id}/ (Paramount) and /{Tenant}/job/{slug}/{id}/ (Lionsgate)
const LINK_RE = /href="(\/(?:[^"/]+\/)?job\/([^"/]+)\/(\d+)\/?)"/g;
const DEFAULT_QUERIES = [
  'strategy', 'business operations', 'corporate development', 'financial planning', 'chief of staff',
];

function getConfig(entry) {
  const c = entry.j2w || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { host: c.host, queries };
}

function titleFromSlug(slug) {
  return decodeURIComponent(slug)
    .replace(/&amp;/g, '&').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/** @type {Provider} */

export default {
  id: 'j2w',

  detect(entry) {
    return entry.j2w ? { url: `https://${getConfig(entry).host || ''}/search/` } : null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { host, queries } = getConfig(entry);
    if (!host) throw new Error(`j2w: "${entry.name}" needs j2w.host in portals.yml`);
    const byId = new Map();
    for (const q of (isProbing(ctx) ? queries.slice(0, 1) : queries)) {
      for (let page = 0; page < pageCap; page++) {
        const url = `https://${host}/search/?q=${encodeURIComponent(q)}&startrow=${page * PAGE_STEP}`;
        const html = await ctx.fetchText(url, { redirect: 'error' });
        let m, before = byId.size;
        LINK_RE.lastIndex = 0;
        while ((m = LINK_RE.exec(html)) !== null) {
          const [, href, slug, id] = m;
          if (byId.has(id)) continue;
          byId.set(id, {
            title: titleFromSlug(slug),
            url: `https://${host}${href}`,
            company: entry.name,
            location: '',
          });
        }
        if (byId.size === before) break;  // no new jobs — end this query
      }
    }
    return [...byId.values()];
  },
};
