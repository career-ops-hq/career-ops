// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages } from './_paging.mjs';

// PCSX provider — Eightfold's newer "PCSX" career-site API.
//
// Eightfold tenants are migrating off the classic /api/apply/v2/jobs endpoint.
// On a migrated tenant that old path does NOT 404 — it answers
//   403 {"message": "Not authorized for PCSX"}
// which reads like a permissions problem but is really a "wrong API" signal, and
// is why Microsoft silently failed for several runs (the retry layer treats the
// 403/429 as transient and gives up). The replacement is same-host, public, and
// needs no auth:
//
//   GET https://{host}/api/pcsx/search
//         ?domain={domain}&query={q}&location={loc}&start={n}&sort_by=relevance
//   -> { status, error, data: { count, positions: [ {
//          id, displayJobId, name, locations[], standardizedLocations[],
//          postedTs, department, atsJobId, positionUrl } ] } }
//
// PAGE SIZE IS FIXED AT 10 and cannot be raised — `num`, `pageSize` and friends
// are all accepted and all ignored (verified live). `start` is the only lever, so
// a broad query is expensive: Microsoft's "strategy" alone reports count=443,
// i.e. 45 requests. Hence the same `queries` design as the eightfold provider —
// narrow server-side first, then let scan.mjs's title_filter make the precise
// cut. PAGE_CAP bounds any single query and warns rather than silently truncating.
//
// `count` is the server's own total, so pagination stops on the count instead of
// probing for an empty page.
//
// Identifiers follow the local ATS-identifier convention (see
// data/local-patches/README.md): displayJobId/atsJobId is Microsoft's own
// requisition number (e.g. "200037390") and survives a repost or ATS host move,
// so it becomes requisitionId; the Eightfold position id becomes externalId.

const DEFAULT_PAGE_SIZE = 10; // server-fixed; here for offset math, not as a request param
// A fixed 10/page over several queries means hundreds of sequential requests, and
// Microsoft's edge starts 429ing partway through a multi-query walk. These three
// constants are tuned together against that: 25 pages/query (~250 postings, ample
// once title_filter runs), 400ms spacing, and a backoff that actually outlasts a
// rate-limit window (2s→32s) instead of giving up inside it. Dropping the delay or
// raising the cap reintroduces the 429.
const PAGE_CAP = 25;
const PAGE_DELAY_MS = 400;
const MAX_JOBS = 2000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

/** @param {import('./_types.js').PortalEntry} entry */
function getConfig(entry) {
  const cfg = entry.pcsx || entry.eightfold || {};
  let host = typeof cfg.host === 'string' ? cfg.host.trim() : '';
  if (!host) {
    try {
      host = new URL(entry.api || entry.careers_url || '').hostname;
    } catch {
      /* leave empty — validated by the caller */
    }
  }
  const queries = Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : [''];
  return {
    host: host.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    domain: typeof cfg.domain === 'string' ? cfg.domain : '',
    location: typeof cfg.location === 'string' ? cfg.location : '',
    queries,
  };
}

/** Retry only the statuses that are genuinely transient. */
async function withRetry(fn, ctx) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!err || !RETRY_STATUSES.has(err.status) || attempt >= MAX_RETRIES) throw err;
      const wait = RETRY_BASE_MS * 2 ** attempt;
      if (typeof ctx?.sleep === 'function') await ctx.sleep(wait);
      else await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Public URL for a posting.
 *
 * The API's own `positionUrl` is `/careers/job/{id}`, but the site serves the
 * SAME posting at `/careers?pid={id}` (both 200), and `?pid=` is the form every
 * pre-existing scan-history row, pipeline entry, and tracker report link already
 * uses — 42 rows plus evaluated report #502 here. url-key.mjs does NOT normalize
 * the two forms to one key (verified), so switching to /careers/job/ would make
 * every one of those postings look brand new the moment fuzzy company+role dedup
 * misses. Continuity wins over the nominally-canonical path; keep `?pid=`.
 *
 * @param {any} p @param {string} host @param {string} company
 */
export function toJob(p, host, company) {
  if (!p || !p.name) return null;
  if (p.id === undefined || p.id === null || String(p.id).trim() === '') return null;
  const url = `https://${host}/careers?pid=${encodeURIComponent(String(p.id))}`;
  // standardizedLocations ("Redmond, WA, US") is the cleaner form for the
  // scanner's location_filter; fall back to the raw locations array.
  const locs = Array.isArray(p.standardizedLocations) && p.standardizedLocations.length
    ? p.standardizedLocations
    : Array.isArray(p.locations)
      ? p.locations
      : [];
  const req = p.displayJobId ?? p.atsJobId;
  return {
    title: String(p.name).trim(),
    url,
    company,
    location: [...new Set(locs.filter(Boolean).map(String))].join('; '),
    // postedTs is epoch SECONDS; Job.postedAt is epoch ms.
    postedAt: Number.isFinite(p.postedTs) && p.postedTs > 0 ? Number(p.postedTs) * 1000 : undefined,
    externalId: p.id === undefined || p.id === null ? undefined : String(p.id),
    requisitionId: req !== undefined && req !== null && String(req).trim() ? String(req).trim() : undefined,
  };
}

/** @type {Provider} */

export default {
  id: 'pcsx',

  detect(entry) {
    if (entry.pcsx) {
      const { host } = getConfig(entry);
      return host ? { url: `https://${host}` } : null;
    }
    return null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { host, domain, location, queries } = getConfig(entry);
    if (!host) throw new Error(`pcsx: no host configured for ${entry.name}`);

    const jobs = [];
    const seen = new Set();

    for (const query of queries) {
      let cappedAt = null;
      for (let page = 0; page < pageCap; page++) {
        if (jobs.length >= MAX_JOBS) break;
        const params = new URLSearchParams({ domain, start: String(page * DEFAULT_PAGE_SIZE), sort_by: 'relevance' });
        if (query) params.set('query', query);
        if (location) params.set('location', location);
        const url = `https://${host}/api/pcsx/search?${params.toString()}`;

        if (page > 0) {
          if (typeof ctx?.sleep === 'function') await ctx.sleep(PAGE_DELAY_MS);
          else await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
        }

        const json = /** @type {any} */ (
          await withRetry(
            () =>
              ctx.fetchJson(url, {
                headers: { 'user-agent': BROWSER_UA, accept: 'application/json', referer: `https://${host}/careers` },
                redirect: 'error',
              }),
            ctx,
          )
        );

        const positions = Array.isArray(json?.data?.positions) ? json.data.positions : [];
        if (!positions.length) break;

        for (const p of positions) {
          const job = toJob(p, host, entry.name);
          if (!job || !job.title || !job.url || seen.has(job.url)) continue;
          seen.add(job.url);
          jobs.push(job);
        }

        // Stop on the server's own total rather than probing for an empty page.
        const total = Number(json?.data?.count);
        if (Number.isFinite(total) && (page + 1) * DEFAULT_PAGE_SIZE >= total) break;
        if (page === PAGE_CAP - 1) cappedAt = total;
      }
      if (cappedAt) {
        console.error(
          `⚠️  pcsx: hit ${PAGE_CAP}-page cap for query "${query || '(all)'}" on ${host} ` +
            `(${cappedAt} results) — narrow with pcsx.queries`,
        );
      }
    }
    return jobs;
  },
};
