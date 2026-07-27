// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// TKMS (thyssenkrupp Marine Systems) provider — the careers app at
// jobs.tkmsgroup.com. Single-employer, but the backend is a shared job-board
// platform keyed by a `subclient` param, so the provider takes the subclient
// (and locale) from a config block for reuse if another tenant on the same
// platform ever needs it.
//
//   POST {origin}/api/filter/query
//   Content-Type: application/json
//   {"searchQuery":"","filter":{},"subclient":"tkms","locale":"en","page":0}
//   → {"jobs":[{"_geoloc":[…],"data":{id,title,city,country,state,company,
//        postingDate:"2026-07-02T22:00:00",locations:[{city,cityState,…}],…}}],
//      "page":0,"jobsPerPage":20,"nextPage":1,"totalHits":330}
//
// `page` is 0-based; `nextPage` is null on the last page. The public job page is
// {origin}/{locale}/job/{slug}/{id} — the slug is cosmetic (a stub resolves the
// same posting, verified), so we slugify the title.
//
// Detection: jobs.tkmsgroup.com is the only known host, and it carries no
// generic platform token, so detect() claims that host explicitly.

const MAX_PAGES = 60; // safety cap on request count (60*20 = 1200 postings)
const MAX_JOBS = 1000; // cap total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing between page requests

/** @param {import('./_types.js').PortalEntry} entry */
export function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.host.toLowerCase();
  if (host !== 'jobs.tkmsgroup.com') return null;
  const block = entry.tkms && typeof entry.tkms === 'object' ? entry.tkms : {};
  const locale = typeof block.locale === 'string' ? block.locale : 'en';
  return {
    origin: u.origin,
    queryApi: `${u.origin}/api/filter/query`,
    subclient: typeof block.subclient === 'string' ? block.subclient : 'tkms',
    locale,
  };
}

// Slugify a title for the cosmetic job-page slug (TKMS uses `_` for the
// gender marker and `-` between words; a stub slug also resolves, so exactness
// doesn't matter — we just produce a clean, hyphenated string).
/** @param {string} title */
export function slugify(title) {
  return String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job';
}

// postingDate is a naive ISO local timestamp ("2026-07-02T22:00:00"); prefer
// the epoch-seconds `postingDate_timestamp` when present.
/** @param {any} data @returns {number | undefined} */
export function parseTkmsDate(data) {
  const ts = data?.postingDate_timestamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts * 1000;
  const raw = data?.postingDate;
  if (typeof raw === 'string' && raw.trim()) {
    const ms = Date.parse(raw.trim() + 'Z'); // treat naive stamp as UTC for determinism
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

// Location: prefer the `locations` array (cityState per site), else the flat
// city/country fields. Joined with " / ", deduped.
/** @param {any} data @returns {string} */
export function tkmsLocation(data) {
  const locs = Array.isArray(data?.locations) ? data.locations : [];
  const out = [];
  for (const l of locs) {
    const s = String(l?.cityState || l?.city || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  if (out.length) return out.join(' / ');
  const flat = [data?.city, data?.country].map((p) => String(p || '').trim()).filter(Boolean);
  return [...new Set(flat)].join(', ');
}

/**
 * Map one query response to {total, nextPage, rows}. A record without an id or
 * title is skipped.
 * @param {any} json @param {{origin:string, locale:string}} cfg
 */
export function parseQuery(json, cfg) {
  const total = typeof json?.totalHits === 'number' ? json.totalHits : null;
  const nextPage = typeof json?.nextPage === 'number' ? json.nextPage : null;
  const list = Array.isArray(json?.jobs) ? json.jobs : [];
  const rows = [];
  for (const item of list) {
    const d = item?.data;
    if (!d) continue;
    const id = d.id != null ? String(d.id) : '';
    const title = String(d.title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!id || !title) continue;
    rows.push({
      id,
      title,
      url: `${cfg.origin}/${encodeURIComponent(cfg.locale)}/job/${slugify(title)}/${encodeURIComponent(id)}`,
      location: tkmsLocation(d),
      postedAt: parseTkmsDate(d),
    });
  }
  return { total, nextPage, rows };
}

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'tkms',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveConfig({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`tkms: cannot resolve jobs host for ${entry.name}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await wait(PAGE_DELAY_MS);
      const json = await ctx.fetchJson(cfg.queryApi, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ searchQuery: '', filter: {}, subclient: cfg.subclient, locale: cfg.locale, page }),
      });
      const { nextPage, rows } = parseQuery(json, cfg);
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
      if (fresh === 0) break; // server looped / ignored page
      if (jobs.length >= MAX_JOBS) break;
      if (nextPage === null) break; // last page
    }
    return jobs;
  },
};
