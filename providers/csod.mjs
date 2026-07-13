// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Cornerstone OnDemand (CSOD) career-site provider — the hosted boards at
// https://{tenant}.csod.com/ux/ats/careersite/{siteId}/home?c={corpName}
// (e.g. OHB: career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb).
//
// The search API is public but wants a bearer token. The career-site home page
// is a small (~5 KB) bootstrap document that embeds an ANONYMOUS JWT as
// `"token":"eyJ…"` — no login, no session cookies needed. Flow per fetch:
//
//   1. GET  {origin}/ux/ats/careersite/{siteId}/home?c={corpName}   → extract token
//   2. POST {origin}/services/x/career-site/v1/search               → page through
//      body: {careerSiteId, careerSitePageId, pageNumber (1-based), pageSize,
//             cultureId, cultureName, searchText:"", …empty facet arrays}
//      → {data: {totalCount, requisitions: [{requisitionId, displayJobTitle,
//                postingEffectiveDate: "M/D/YYYY", locations: [{city,state,country}]}]}}
//
// Job detail URL (verified live): {origin}/ux/ats/careersite/{siteId}/home/
// requisition/{requisitionId}?c={corpName}.
//
// Detection: *.csod.com hosts auto-claim when the path carries the careersite
// shape; the branded corporate page goes in careers_url and the csod.com URL in
// `api:` (same convention as workday/successfactors).

const PAGE_SIZE = 25; // server default; verified OHB serves exactly 25/page
const MAX_PAGES = 40; // safety cap on request count (40*25 = 1000 postings)
const MAX_JOBS = 1000; // cap total postings pulled per site
const PAGE_DELAY_MS = 120; // polite pacing between search requests

/**
 * Parse tenant/site/corp out of a careersite URL.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, siteId: number, corpName: string, homeUrl: string, searchApi: string} | null}
 */
export function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.host.toLowerCase();
  if (host !== 'csod.com' && !host.endsWith('.csod.com')) return null;
  const m = u.pathname.match(/\/ux\/ats\/careersite\/(\d+)\//i) || u.pathname.match(/\/ux\/ats\/careersite\/(\d+)$/i);
  if (!m) return null;
  const siteId = Number(m[1]);
  const corpName = u.searchParams.get('c') || host.split('.')[0];
  return {
    origin: u.origin,
    siteId,
    corpName,
    homeUrl: `${u.origin}/ux/ats/careersite/${siteId}/home?c=${encodeURIComponent(corpName)}`,
    searchApi: `${u.origin}/services/x/career-site/v1/search`,
  };
}

/**
 * Pull the anonymous bearer token out of the bootstrap home page.
 * @param {string} html @returns {string}
 */
export function extractToken(html) {
  const m = typeof html === 'string' ? html.match(/"token"\s*:\s*"([A-Za-z0-9._-]+)"/) : null;
  return m ? m[1] : '';
}

// postingEffectiveDate is US-format M/D/YYYY ("7/3/2026") → epoch ms (UTC for
// determinism; consumers only use this for coarse recency ranking).
/** @param {unknown} raw @returns {number | undefined} */
export function parseCsodDate(raw) {
  const m = typeof raw === 'string' ? raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
  if (!m) return undefined;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(year, month - 1, day);
  if (new Date(ms).getUTCDate() !== day) return undefined; // catches 4/31, 2/30, etc.
  return Number.isFinite(ms) ? ms : undefined;
}

// locations is an array of {city, state, country}. City is the useful part;
// append the country code when present ("Bremen, DE"). Multiple work locations
// join with " / ".
/** @param {unknown} raw @returns {string} */
export function cleanLocations(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const loc of list) {
    if (!loc || typeof loc !== 'object') continue;
    const city = String(loc.city || '').trim();
    const country = String(loc.country || '').trim();
    const s = city ? (country ? `${city}, ${country}` : city) : country;
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join(' / ');
}

/**
 * Map one search response page to raw {id, title, url, location, postedAt}.
 * Records without an id or a title are skipped (no stable dedup key / no
 * meaningful listing).
 * @param {any} json @param {{origin:string, siteId:number, corpName:string}} cfg
 */
export function parseRequisitions(json, cfg) {
  const list = Array.isArray(json?.data?.requisitions) ? json.data.requisitions : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = r.requisitionId != null ? String(r.requisitionId) : '';
    const title = String(r.displayJobTitle || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!id || !title) continue;
    out.push({
      id,
      title,
      url: `${cfg.origin}/ux/ats/careersite/${cfg.siteId}/home/requisition/${id}?c=${encodeURIComponent(cfg.corpName)}`,
      location: cleanLocations(r.locations),
      postedAt: parseCsodDate(r.postingEffectiveDate),
    });
  }
  return out;
}

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'csod',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    // Host check (not a path substring) so evil.com/x.csod.com can't spoof it,
    // and the URL must carry the careersite path shape we know how to drive.
    return resolveConfig({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`csod: cannot resolve careersite URL for ${entry.name}`);

    const html = await ctx.fetchText(cfg.homeUrl, { headers: { accept: 'text/html' } });
    const token = extractToken(html);
    if (!token) throw new Error(`csod: no anonymous token on ${cfg.homeUrl}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();
    let total = null;

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await wait(PAGE_DELAY_MS);
      const json = await ctx.fetchJson(cfg.searchApi, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          careerSiteId: cfg.siteId,
          careerSitePageId: cfg.siteId,
          pageNumber: page,
          pageSize: PAGE_SIZE,
          cultureId: 1,
          cultureName: 'en-US',
          searchText: '',
          states: [],
          countryCodes: [],
          cities: [],
          placeID: '',
          radius: null,
          postingsWithinDays: null,
          customFieldCheckboxKeys: [],
          customFieldDropdowns: [],
          customFieldRadios: [],
        }),
      });
      if (total === null) {
        total = typeof json?.data?.totalCount === 'number' ? json.data.totalCount : null;
      }
      const rows = parseRequisitions(json, cfg);
      if (rows.length === 0) break;

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        const job = { title: row.title, url: row.url, company: entry.name, location: row.location };
        if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
        jobs.push(job);
        if (jobs.length >= MAX_JOBS) break;
      }
      // No new ids → server ignored the page number (or we've looped). Stop.
      if (fresh === 0) break;
      if (jobs.length >= MAX_JOBS) break;
      if (total !== null && page * PAGE_SIZE >= total) break;
      if (rows.length < PAGE_SIZE) break;
    }
    return jobs;
  },
};
