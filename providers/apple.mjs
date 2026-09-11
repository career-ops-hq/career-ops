// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Apple provider — jobs.apple.com is a React Router SSR app with NO usable JSON API.
//
// Why not the API: `POST /api/v1/search` exists (with an X-Apple-CSRF-Token from
// `GET /api/v1/CSRFToken`) but returns `{"res":{"searchResults":[],"totalRecords":0}}`
// for every payload shape, cookies and Referer included. Observing the live page in a
// browser shows the SPA never calls it — the search results are server-rendered and
// embedded in the HTML as a React Router hydration blob:
//
//   window.__staticRouterHydrationData = JSON.parse("{...}");
//     -> loaderData.search.searchResults   (20 jobs/page)
//     -> loaderData.search.totalRecords
//
// So this provider fetches the ordinary search URL over plain HTTP and reads that blob.
// Zero tokens, no browser required.
//
// Two complementary discovery modes (both optional, both deduped by URL):
//   queries: text search with `sort=relevance`. Apple's text match is loose (it hits
//            job descriptions too, so "business operations" reports 2000+ records), but
//            relevance ranking puts the real title matches on page 1-2 — hence max_pages.
//   teams:   team-slug filter (e.g. business-process-management-OPMFG-BPM). Precise and
//            small. This is how Apple's non-obvious orgs are reachable at all: Apple has
//            no "Corporate Strategy" title — that work lives in Operations under
//            "Business Process Re-Engineering (BPR)".
//
// scan.mjs's title_filter still does the actual role selection; this provider only
// supplies candidates.

const ALLOWED_HOST = 'jobs.apple.com';
const BASE = 'https://jobs.apple.com';
const PAGE_SIZE = 20;

// Apple 403s a bare/absent UA on the SSR route.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_LOCATION = 'united-states-USA';
const DEFAULT_QUERIES = [
  'corporate strategy',
  'business operations',
  'strategic finance',
  'corporate development',
  'chief of staff',
  'financial planning',
];
// Apple's in-house strategy/ops-consulting org. Mixed content (much of it is
// supply-chain / NPI / data-eng program management), but it is the only home of
// titles like "Manager, Business Operations Strategy & Support - WW Ops BPR".
const DEFAULT_TEAMS = ['business-process-management-OPMFG-BPM'];
const DEFAULT_MAX_PAGES = 2;

// Matches the escaped JSON string argument, honouring backslash escapes so an
// embedded \" inside the blob can't terminate the capture early.
const HYDRATION_RE = /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)/;

/** @param {string} url */
function assertAppleUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`apple: invalid URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`apple: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST) throw new Error(`apple: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

/**
 * Pull loaderData.search out of the SSR hydration blob.
 * @param {string} html
 * @returns {{ searchResults?: any[], totalRecords?: number } | null}
 */
export function parseHydration(html) {
  const m = HYDRATION_RE.exec(html || '');
  if (!m) return null;
  try {
    // The blob is a JSON string literal inside JSON.parse("..."), so it needs
    // unescaping (pass 1) before it parses as JSON (pass 2).
    const data = JSON.parse(JSON.parse(`"${m[1]}"`));
    return data?.loaderData?.search ?? null;
  } catch {
    return null;
  }
}

/** @param {any} r */
function locationOf(r) {
  const names = (Array.isArray(r.locations) ? r.locations : [])
    .map((/** @type {any} */ l) => l?.name)
    .filter(Boolean);
  const uniq = [...new Set(names)];
  if (uniq.length) return uniq.join('; ');
  return r.isMultiLocation ? 'Various Locations within United States' : '';
}

/** @param {any} r */
function urlOf(r) {
  const slug = r.transformedPostingTitle || 'role';
  const team = r.team?.teamCode ? `?team=${encodeURIComponent(r.team.teamCode)}` : '';
  return `${BASE}/en-us/details/${encodeURIComponent(r.id)}/${slug}${team}`;
}

/** @param {any} r @param {string} company @returns {Job} */
function toJob(r, company) {
  const posted = Date.parse(r.postDateInGMT || '');
  return {
    title: String(r.postingTitle || '').trim(),
    url: urlOf(r),
    company,
    location: locationOf(r),
    ...(Number.isNaN(posted) ? {} : { postedAt: posted }),
  };
}

/** @param {Record<string, string>} params */
function searchUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${BASE}/en-us/search?${qs}`;
}

/** @type {Provider} */
export default {
  id: 'apple',

  detect(entry) {
    const url = entry.careers_url || '';
    try {
      if (new URL(url).hostname === ALLOWED_HOST) return { url };
    } catch {
      // not a URL — fall through
    }
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = /** @type {any} */ (entry).apple || {};
    const location = cfg.location || DEFAULT_LOCATION;
    const queries = Array.isArray(cfg.queries) ? cfg.queries : DEFAULT_QUERIES;
    const teams = Array.isArray(cfg.teams) ? cfg.teams : DEFAULT_TEAMS;
    const maxPages = Number.isFinite(cfg.max_pages) ? Math.max(1, cfg.max_pages) : DEFAULT_MAX_PAGES;

    /** @type {Map<string, Job>} */
    const byUrl = new Map();

    /** Page through one search axis, stopping early on the last page. */
    const harvest = async (/** @type {Record<string,string>} */ base) => {
      for (let page = 1; page <= maxPages; page++) {
        const url = searchUrl({ ...base, page: String(page) });
        assertAppleUrl(url);
        let html;
        try {
          html = await ctx.fetchText(url, { headers: { 'User-Agent': UA }, redirect: 'error' });
        } catch {
          return; // transient fetch failure on this axis — other axes still contribute
        }
        const search = parseHydration(html);
        // A null blob means Apple changed its SSR shape; bail rather than loop.
        if (!search) return;
        const rows = Array.isArray(search.searchResults) ? search.searchResults : [];
        for (const r of rows) {
          if (!r?.postingTitle || !r?.id) continue;
          const job = toJob(r, entry.name);
          if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        }
        const total = Number(search.totalRecords) || 0;
        if (rows.length < PAGE_SIZE || page * PAGE_SIZE >= total) return;
      }
    };

    for (const q of queries) await harvest({ search: String(q), location, sort: 'relevance' });
    for (const t of teams) await harvest({ location, team: String(t) });

    return [...byUrl.values()];
  },
};
