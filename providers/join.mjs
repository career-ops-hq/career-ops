// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// join.com provider — reads jobs from Next.js __NEXT_DATA__ embedded in HTML.
// Auto-detects from careers_url matching join.com/companies/<slug>.
// No API key needed — data is SSR-rendered in the page HTML.

// Safety cap on pagination — applied regardless of what the page's own
// __NEXT_DATA__ reports as pagination.pageCount, so a board that grows (or a
// payload that reports a wrong pageCount) can't drive this into an unbounded
// fetch loop; nothing wraps the provider call with a timeout of its own.
// Every known tenant is a single company's careers page, so 50 pages is
// generous headroom; override with `max_pages` on the portal entry for a
// tenant that genuinely exceeds it.
const DEFAULT_MAX_PAGES = 50;
// Hard ceiling even for an explicit override.
const MAX_PAGES_CAP = 200;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

export function extractSlug(url) {
  let parsed;
  try { parsed = new URL(url || ''); } catch { return null; }
  if (parsed.hostname.toLowerCase() !== 'join.com') return null;
  const match = parsed.pathname.match(/^\/companies\/([^/?#]+)/);
  return match?.[1] || null;
}

export function extractNextData(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/<script[^>]+__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/** @type {Provider} */
export default {
  id: 'join',

  detect(entry) {
    return extractSlug(entry.careers_url) ? { url: entry.careers_url } : null;
  },

  async fetch(entry, ctx) {
    const slug = extractSlug(entry.careers_url);
    if (!slug) throw new Error('join: cannot extract slug from careers_url');

    const baseUrl = `https://join.com/companies/${slug}`;
    const allItems = [];

    // redirect:'error' prevents SSRF via server-side redirects; baseUrl is
    // always reconstructed as https://join.com/... so the host is pinned
    // regardless of the original careers_url.
    const firstHtml = await ctx.fetchText(baseUrl, { redirect: 'error' });
    const firstData = extractNextData(firstHtml);
    const state = firstData?.props?.pageProps?.initialState;
    if (!state) throw new Error('join: __NEXT_DATA__ not found or unexpected structure');

    const firstJobs = state.jobs?.items;
    if (!Array.isArray(firstJobs)) throw new Error('join: __NEXT_DATA__ not found or unexpected structure');
    allItems.push(...firstJobs);

    // Honor a context page cap — verify-portals' liveness probe sets
    // `ctx.maxPages: 1` so it only needs to know a board is live, not its
    // full count (mirrors providers/workday.mjs). No effect on real scans,
    // which don't set ctx.maxPages. Kept separate from `maxPages` below so
    // the "raise max_pages" warning only fires when the entry-level cap is
    // what actually truncated the board, not the health-check probe.
    const ctxMaxPages = Number(ctx?.maxPages);
    const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Infinity;
    const reportedPageCount = state.jobs?.pagination?.pageCount || 0;
    const maxPages = resolveMaxPages(entry);
    const pageCount = Math.min(reportedPageCount, maxPages, ctxCap);
    for (let page = 2; page <= pageCount; page++) {
      const html = await ctx.fetchText(`${baseUrl}?page=${page}`, { redirect: 'error' });
      const data = extractNextData(html);
      const pageState = data?.props?.pageProps?.initialState;
      if (!pageState) throw new Error('join: __NEXT_DATA__ not found or unexpected structure');
      const pageItems = pageState.jobs?.items;
      if (!Array.isArray(pageItems)) throw new Error('join: __NEXT_DATA__ not found or unexpected structure');
      allItems.push(...pageItems);
    }
    if (pageCount === maxPages && reportedPageCount > maxPages && ctxCap === Infinity) {
      console.error(`⚠️  join: ${entry.name} truncated at max_pages=${maxPages} of ${reportedPageCount} reported pages — raise max_pages on this entry for more`);
    }

    const companySlug = state.company?.domain || slug;
    return allItems.map(j => ({
      title: j.title || '',
      url: `https://join.com/companies/${companySlug}/jobs/${j.idParam}`,
      company: entry.name,
      location: j.city?.cityName || '',
    }));
  },
};
