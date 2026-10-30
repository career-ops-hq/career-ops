// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { cachedLookup } from './_cached-lookup.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';

// join.com provider — single-company ATS adapter for `tracked_companies:`.
// Auto-detects from careers_url matching join.com/companies/<slug>.
// No API key needed. Two steps:
//   1. The careers page (https://join.com/companies/<slug>) embeds the company
//      record in its Next.js __NEXT_DATA__ blob; only `company.id` is read from
//      it. The blob is `props.pageProps.pageData`, or `initialState` in pages
//      rendered by the older frontend that Cloudflare can still serve from
//      cache.
//   2. The job list comes from the public GraphQL endpoint the careers page
//      itself calls when the visitor pages through the list
//      (POST https://join.com/candidate-api/graphql, query `publicJobs`). The
//      job list embedded in the HTML is not used: Cloudflare serves the page
//      from a cache that can be days old, `?page=N` can return a cached copy of
//      another page, and each page holds only 5 jobs.
//
// The company id is assumed not to change, so step 1 is skipped where the id
// is already known: `entry.company_id` when a directory supplies it, else
// `ctx.idCache` (see provider-id-cache.mjs) from an earlier scan. A cached id
// is checked against the careers page again once it is older than
// DEFAULT_RECHECK_MS (_cached-lookup.mjs), which is also how a deleted company
// — one whose old id still answers with an empty job list — surfaces as a dead
// board, and how a changed id would be picked up.
//
// `parseCompanySitemap` reads join.com's own company directory,
// https://join.com/companies/sitemap.xml, for scan-ats-full.mjs.

const GRAPHQL_URL = 'https://join.com/candidate-api/graphql';

// The server caps pageSize at 100: a larger value still returns 100 items and
// a pageInfo.pageCount computed for 100.
const PAGE_SIZE = 100;

const PUBLIC_JOBS_QUERY = `query PublicJobsList($input: PublicJobsQueryInput!) {
  publicJobs(input: $input) {
    items {
      id
      title
      createdAt
      descriptionHtml
      language {
        iso6391
      }
      workplaceType
      remoteType
      remoteRegion {
        name
      }
      city {
        cityName
        countryName
      }
      country {
        name
      }
    }
    pageInfo {
      pageCount
    }
  }
}`;

// Safety cap on pagination — applied regardless of what the response reports
// as pageInfo.pageCount, so a board that grows (or a payload that reports a
// wrong pageCount) can't drive this into an unbounded fetch loop; nothing wraps
// the provider call with a timeout of its own. At PAGE_SIZE jobs per page, 50
// pages is far more than any single company's board needs; override with
// `max_pages` on the portal entry for a tenant that genuinely exceeds it.
const DEFAULT_MAX_PAGES = 50;
// Hard ceiling even for an explicit override.
const MAX_PAGES_CAP = 200;

// The GraphQL endpoint rate-limits across all tenants: about 100 requests in a
// burst, then every request is refused for a few seconds, and a sustained
// sweep is held to roughly ten boards a second. The refusal is an HTTP 200
// whose body carries a GraphQL error with `extensions.code` TOO_MANY_REQUESTS,
// so `rateLimitAware` below turns it into a 429 for the shared retry. The
// backoff (2 s, 4 s, 8 s, 16 s, 16 s) outlasts the refusal window even when
// several boards are waiting on it at once.
const RETRY_POLICY = { retries: 5, baseDelayMs: 2_000, maxDelayMs: 16_000 };
// Spacing between the pages of one board. Few boards have more than one page
// of PAGE_SIZE jobs; the delay keeps the walk of a big one from adding a burst
// on top of the cross-tenant limit above.
const INTER_PAGE_DELAY_MS = 250;
const RATE_LIMIT_CODE = 'TOO_MANY_REQUESTS';
// Fallback for a refusal that arrives without the code.
const RATE_LIMIT_RE = /too many requests/i;

// How the careers page labels a posting's place, from workplaceType and
// remoteType: an on-site or hybrid posting shows its city and country, a
// remote one only the area it is open to. The city of a remote posting is the
// company's default city, not a requirement, so it is left out.
/**
 * @param {any} j - A publicJobs item.
 * @returns {string}
 */
export function formatLocation(j) {
  const city = typeof j?.city?.cityName === 'string' ? j.city.cityName.trim() : '';
  const country = [j?.country?.name, j?.city?.countryName].find(v => typeof v === 'string' && v.trim())?.trim() || '';
  if (j?.workplaceType === 'REMOTE') {
    const region = typeof j.remoteRegion?.name === 'string' ? j.remoteRegion.name.trim() : '';
    const area = j.remoteType === 'ANYWHERE' ? 'worldwide' : j.remoteType === 'REGION' ? region : country;
    return area ? `Remote (${area})` : 'Remote';
  }
  const place = [city, country].filter(Boolean).join(', ');
  if (j?.workplaceType === 'HYBRID') return place ? `${place} (hybrid)` : 'Hybrid';
  return place;
}

// NaN-safe ISO → epoch ms; an absent or unparseable date leaves postedAt unset
// so the age filters treat the posting as undated instead of as epoch zero.
function toEpochMs(value) {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

export function extractSlug(url) {
  let parsed;
  try { parsed = new URL(url || ''); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'join.com') return null;
  const match = parsed.pathname.match(/^\/companies\/([^/?#]+)/);
  return match?.[1] || null;
}

export function extractNextData(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/<script[^>]+__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/**
 * The company record from a careers page's __NEXT_DATA__, in either frontend
 * shape. Null when neither shape carries a numeric company id.
 * @param {any} nextData
 * @returns {{ id: number, domain?: string } | null}
 */
export function extractCompany(nextData) {
  const pageProps = nextData?.props?.pageProps;
  const company = (pageProps?.pageData ?? pageProps?.initialState)?.company;
  return Number.isInteger(company?.id) ? company : null;
}

/**
 * Company slugs from join.com's company sitemap, in document order, each once.
 * Only `<loc>https://join.com/companies/<slug></loc>` entries count; a deeper
 * path or another host is skipped, and XML entities in `<loc>` are decoded.
 * An empty `<urlset>` is an empty directory. A sitemap without a complete
 * `<urlset>` element, or with `<url>` or `<loc>` entries of which none yields
 * a company page, throws, so the caller keeps its last good list.
 * @param {unknown} xml
 * @returns {string[]}
 */
export function parseCompanySitemap(xml) {
  if (typeof xml !== 'string') throw new Error('join: company sitemap is not text');
  // The root element must be complete: a download cut short still opens
  // <urlset> and would pass for a shorter directory.
  if (!/<urlset\b[^>]*\/>|<urlset\b[^>]*>[\s\S]*<\/urlset\s*>/.test(xml)) {
    throw new Error('join: company sitemap has no complete <urlset> element');
  }
  const slugs = new Set();
  let locs = 0;
  for (const [, raw] of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    locs++;
    const loc = decodeEntities(raw);
    const slug = extractSlug(loc);
    if (slug && new URL(loc).pathname.replace(/\/$/, '') === `/companies/${slug}`) slugs.add(slug);
  }
  const urls = [...xml.matchAll(/<url\b/g)].length;
  if ((urls > 0 || locs > 0) && slugs.size === 0) {
    throw new Error(`join: company sitemap has ${urls} <url> and ${locs} <loc> entries but no company page among them`);
  }
  return [...slugs];
}

/**
 * The company id for a board: from the entry, from the cache, or from the
 * careers page, in that order.
 * @param {any} entry
 * @param {string} slug
 * @param {any} ctx
 * @returns {Promise<number>}
 */
async function resolveCompanyId(entry, slug, ctx) {
  if (Number.isInteger(entry?.company_id) && entry.company_id > 0) return entry.company_id;

  return cachedLookup(ctx?.idCache, slug, async () => {
    // redirect:'error' prevents SSRF via server-side redirects; the URL is a
    // fixed https://join.com/... string, so the host is pinned regardless of
    // the original careers_url.
    const html = await fetchTextWithRetry(ctx, `https://join.com/companies/${slug}`, { redirect: 'error' });
    const company = extractCompany(extractNextData(html));
    if (!company) throw new Error('join: __NEXT_DATA__ not found or has no company id');
    return company.id;
  }, {
    isValid: (v) => Number.isInteger(v) && v > 0,
    // The job list answers a deleted company's old id with an empty list, so
    // the careers page answering 404 / 410 is the only sign it is gone.
    isGone: (err) => err?.status === 404 || err?.status === 410,
  });
}

/**
 * A ctx whose fetchJson throws a 429-shaped error when the GraphQL endpoint
 * answers with its rate-limit error, so fetchJsonWithRetry backs off on it.
 * @param {any} ctx
 */
function rateLimitAware(ctx) {
  return {
    ...ctx,
    fetchJson: async (url, opts) => {
      const json = await ctx.fetchJson(url, opts);
      const error = json?.errors?.[0];
      const message = typeof error?.message === 'string' ? error.message : '';
      if (error?.extensions?.code === RATE_LIMIT_CODE || RATE_LIMIT_RE.test(message)) {
        throw Object.assign(new Error(`join: ${message || RATE_LIMIT_CODE}`), { status: 429 });
      }
      return json;
    },
  };
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

    const companyId = await resolveCompanyId(entry, slug, ctx);

    // Honor a context page cap — verify-portals' liveness probe sets
    // `ctx.maxPages: 1` so it only needs to know a board is live, not its
    // full count (mirrors providers/workday.mjs). No effect on real scans,
    // which don't set ctx.maxPages. Kept separate from `maxPages` below so
    // the "raise max_pages" warning only fires when the entry-level cap is
    // what actually truncated the board, not the health-check probe.
    const ctxMaxPages = Number(ctx?.maxPages);
    const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Infinity;
    const maxPages = resolveMaxPages(entry);
    const gqlCtx = rateLimitAware(ctx);

    // A page that still fails after the retries fails the whole board: a
    // partial list would read as postings that closed. The truncation warning
    // and tag below are only for the page cap.
    const allItems = [];
    let reportedPageCount = 1;
    let page = 1;
    for (; page <= Math.min(reportedPageCount, maxPages, ctxCap); page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const json = /** @type {any} */ (await fetchJsonWithRetry(gqlCtx, GRAPHQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'PublicJobsList',
          query: PUBLIC_JOBS_QUERY,
          variables: { input: { companyId, paginationPage: { page, pageSize: PAGE_SIZE }, filters: {} } },
        }),
        redirect: 'error',
      }, RETRY_POLICY));
      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        throw new Error(`join: publicJobs failed: ${json.errors[0]?.message || 'unknown GraphQL error'}`);
      }
      const items = json?.data?.publicJobs?.items;
      if (!Array.isArray(items)) throw new Error('join: publicJobs response has no items array');
      // A missing page count would end the walk after this page and return a
      // partial board, so it fails like any other unexpected envelope. 0 is a
      // valid count: an empty board reports it. A page that has jobs but a
      // count below its own number ends the walk the same way, so it fails too.
      const pageCount = json.data.publicJobs.pageInfo?.pageCount;
      if (!Number.isInteger(pageCount) || pageCount < 0) {
        throw new Error(`join: publicJobs response has no valid pageInfo.pageCount (got ${JSON.stringify(pageCount)})`);
      }
      if (items.length > 0 && pageCount < page) {
        throw new Error(`join: publicJobs page ${page} has ${items.length} jobs but pageInfo.pageCount is ${pageCount}`);
      }
      allItems.push(...items);
      reportedPageCount = pageCount;
    }
    const fetchedPages = page - 1;
    const truncated = fetchedPages === maxPages && reportedPageCount > maxPages && ctxCap === Infinity;
    if (truncated) {
      console.error(`⚠️  join: ${entry.name} truncated at max_pages=${maxPages} of ${reportedPageCount} reported pages — raise max_pages on this entry for more`);
    }

    // The URL carries the job's numeric `id`, the one identifier that stays the
    // same for the posting's whole life, so it works as the scan's dedup key.
    // The path the site itself links to is `<idParam>` (`<number>-<title>`),
    // whose number changes whenever the posting is republished; join.com
    // redirects `/companies/<slug>/<id>` to the current `<idParam>` page. The
    // slug is the company's own: the careers page answers only at it (any
    // other spelling is a redirect, which fetch refuses), so it is the same
    // whether the id came from the page or from the cache.
    // postedAt is `createdAt`, the day the posting was first created. A
    // republished posting keeps it, so a role left open for a year reads as a
    // year old. The list payload carries each posting's full body, so the
    // description costs no extra request. It is kept whole (no DESCRIPTION_CAP),
    // like ashby, lever and gem: the description filters read the end of a JD
    // too, where benefits and visa wording usually sit, and about one join
    // posting in seven runs past the default cap. `language` is the posting
    // text's ISO 639-1 code.
    // A row without an integer id or a title is malformed: it is dropped and
    // the rest of the board stands.
    const jobs = allItems
      .filter(j => Number.isInteger(j?.id) && typeof j.title === 'string' && j.title.trim())
      .map(j => {
        const postedAt = toEpochMs(j.createdAt);
        const description = htmlToText(j.descriptionHtml, { cap: Infinity });
        const language = typeof j.language?.iso6391 === 'string' ? j.language.iso6391.trim() : '';
        return {
          title: j.title.trim(),
          url: `https://join.com/companies/${slug}/${j.id}`,
          company: entry.name,
          location: formatLocation(j),
          ...(postedAt ? { postedAt } : {}),
          ...(description ? { description } : {}),
          ...(language ? { language } : {}),
        };
      });
    // Tag a cap-truncated board (the workdayTruncated convention) so a caller can tell without reading stderr.
    if (truncated) /** @type {any} */ (jobs).joinTruncated = true;
    return jobs;
  },
};
