// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Tech in Asia provider — queries the public Algolia search index the
// techinasia.com jobs UI itself calls (`job_postings`).
//
// Tech in Asia (techinasia.com) is a Singapore-based startup-ecosystem publisher
// whose job board is a real employer-attributed inventory: 300 live postings when
// sampled on 2026-09-23, 273 of them Indonesian, the rest Singapore / Malaysia /
// Vietnam / Philippines / Japan. Its robots.txt explicitly ALLOWS AI crawlers by
// name (one group listing ClaudeBot, GPTBot, Claude-User, anthropic-ai and
// others, repeating the `User-agent: *` group's Disallow lines), so listing pages
// are not a restricted source.
//
// The Algolia app id + client search key are public but rotate with the site's
// build, so they are discovered fresh on every run instead of being hardcoded:
//   1. GET /jobs/search                  → the current `app.<hash>.js` asset name
//   2. GET that asset                    → `apiKey:"…", appId:"…"` from its config
//   3. POST the Algolia `job_postings` index with those credentials
// The key is referer-gated, so each Algolia request sends a techinasia.com
// Referer. `parseAlgoliaCredentials` / `findAppAssetPath` are exported for tests.
//
// The board's own default view is filtered to `country_name[]=Indonesia`. This
// provider deliberately does NOT send that filter: it traverses the index's whole
// inventory and leaves targeting to the scanner's title_filter/location_filter
// (Source Indexing Policy rule 3). The index also carries `is_boosted` (299 of
// 300 rows when sampled) and `starts_featuring_at`; neither is read as a filter
// or a signal, so paid placement cannot buy position here.
//
// Explicit-only: `provider: techinasia` in portals.yml. Auto-detection is not
// supported — this is a job board aggregator, not a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   maxPages            — page cap (default 5, 1000 rows per page)
//   techinasia.appId    — override the discovered Algolia app id
//   techinasia.apiKey   — override the discovered Algolia client search key
//
// Canonical URL: the employer's own application link when the row exposes one
// (`external_link`) — rule 2's "shortest verifiable path to the employer" — with
// the Tech in Asia posting page as the fallback. Two kinds of external link are
// rejected in favour of the posting page:
//
//   - a URL shortener, whose destination is not verifiable and can change after
//     the listing is indexed (the same call `telegram-channel.mjs` makes);
//   - a link shared by MORE THAN ONE posting. Sample (2026-09-23): five distinct
//     roles — Account Strategist, Sr. Account Strategist, People Operations
//     Intern and others — all point at one noteforms.com intake form. Since
//     `url` is the scanner's dedup key, preferring it would collapse five real
//     postings into one row and quietly cut the board's inventory (rule 3).
//     A link is therefore used only when it is that posting's own; `fetch()`
//     counts links across the whole board before normalizing for this reason.
//     The other 14 external links sampled were genuine per-role employer ATS
//     pages (Workday, Trakstar, HENNGE), which is exactly the case rule 2 wants.
//
// Salary is deliberately not attached. The index's `salary_min` / `salary_max` /
// `salary_avg` are flags, not money (all three read `1` on live rows while
// `is_salary_visible` is separately `1`), and the normalized Job contract's
// `salary` is annualized compensation.
//
// `published_at` is a naive "YYYY-MM-DD HH:mm:ss" with no zone; it is read as UTC
// so the posting day does not shift with the scanning machine's timezone.

import { htmlToText } from './_html-to-text.mjs';

const SITE_ORIGIN = 'https://www.techinasia.com';
const SEARCH_PAGE_URL = `${SITE_ORIGIN}/jobs/search`;
const ASSET_HOST = 'static.techinasia.com';
const INDEX = 'job_postings';
// Algolia's per-request ceiling. The whole board (300 rows live) arrives in one
// request at this size, so pagination only matters if it grows past 1000.
const HITS_PER_PAGE = 1000;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 50;

// Opaque redirectors: a link through one of these cannot be verified to reach the
// employer, so the source's own posting page is preferred over it.
const URL_SHORTENER_HOSTS = new Set([
  'bit.ly',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'lnkd.in',
  'rb.gy',
  'rebrand.ly',
  's.id',
  'shorturl.at',
  't.co',
  'tinyurl.com',
]);

/** Pin a URL to an expected https host. */
function assertHost(url, host, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`techinasia: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`techinasia: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== host) {
    throw new Error(`techinasia: untrusted ${label} hostname "${parsed.hostname}" — must be ${host}`);
  }
  return url;
}

/**
 * Find the current hashed app bundle path in the served /jobs/search HTML.
 * The asset name rotates per deploy, which is why the credentials are read from
 * the live build instead of being pinned here.
 *
 * @param {string} html
 * @returns {string} absolute https asset URL
 */
export function findAppAssetPath(html) {
  if (typeof html !== 'string') throw new Error('techinasia: app asset lookup got no HTML');
  const m = html.match(/\/\/static\.techinasia\.com(\/assets\/v5\/app\.[0-9a-f]{8}\.js)/);
  if (!m) throw new Error('techinasia: could not find the app bundle in /jobs/search HTML');
  return assertHost(`https://${ASSET_HOST}${m[1]}`, ASSET_HOST, 'asset');
}

/**
 * Pull the Algolia app id + client search key out of the app bundle's config.
 *
 * @param {string} js
 * @returns {{ appId: string, apiKey: string }}
 */
export function parseAlgoliaCredentials(js) {
  if (typeof js !== 'string') throw new Error('techinasia: credential lookup got no bundle');
  const m = js.match(/apiKey:\s*"([A-Za-z0-9]{16,64})"\s*,\s*appId:\s*"([A-Za-z0-9]{6,16})"/);
  if (!m) throw new Error('techinasia: Algolia credentials not found in the app bundle');
  const [, apiKey, appId] = m;
  return { appId, apiKey };
}

/**
 * The Algolia search endpoint for an app id.
 *
 * The credentials ride as QUERY PARAMETERS, not headers — the app id also names
 * the host. Omitting them is a silent-looking HTTP 403, which is how this was
 * first caught (the key was discovered correctly and then never sent).
 *
 * @param {string} appId
 * @param {string} apiKey
 */
function algoliaEndpoint(appId, apiKey) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(appId)) {
    throw new Error(`techinasia: unexpected Algolia app id ${JSON.stringify(appId)}`);
  }
  const host = `${appId.toLowerCase()}-dsn.algolia.net`;
  const url = new URL(`https://${host}/1/indexes/*/queries`);
  url.searchParams.set('x-algolia-agent', 'Algolia for vanilla JavaScript 3.30.0;JS Helper 2.26.1');
  url.searchParams.set('x-algolia-application-id', appId);
  url.searchParams.set('x-algolia-api-key', apiKey);
  return assertHost(url.href, host, 'Algolia');
}

/**
 * Parse the index's naive "YYYY-MM-DD HH:mm:ss" timestamp as UTC.
 * @param {unknown} value
 * @returns {number|undefined} epoch ms
 */
function parsePublishedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  // Zone-less stamps get an explicit Z so the day is the same on every machine;
  // anything already carrying a zone is parsed as-is.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The row's verifiable external application link, or '' when it has none worth
 * using. Rejects non-https and shortener hosts.
 * @param {any} hit
 * @returns {string}
 */
function externalLinkOf(hit) {
  const external = typeof hit?.external_link === 'string' ? hit.external_link.trim() : '';
  if (!external) return '';
  try {
    const parsed = new URL(external);
    if (parsed.protocol !== 'https:') return '';
    if (URL_SHORTENER_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * The employer's own application link when the row exposes a verifiable one,
 * otherwise the Tech in Asia posting page.
 *
 * @param {any} hit
 * @param {Set<string>} [sharedLinks] — external links used by more than one
 *   posting. A link in this set is not that posting's own path, so the posting
 *   page is preferred instead (see the header: one form, five roles).
 * @returns {string}
 */
export function resolveTechInAsiaUrl(hit, sharedLinks) {
  const id = typeof hit?.id === 'string' ? hit.id.trim() : typeof hit?.objectID === 'string' ? hit.objectID.trim() : '';
  const external = externalLinkOf(hit);
  if (external && !(sharedLinks && sharedLinks.has(external))) return external;
  return id ? `${SITE_ORIGIN}/jobs/${id}` : '';
}

/**
 * Normalize one Algolia hit into the canonical Job shape. Exported for tests.
 *
 * Field mapping:
 *   - title:    `title`
 *   - url:      `external_link` when it is a verifiable https link, else
 *               https://www.techinasia.com/jobs/{id}
 *   - company:  `company` (a JSON string in the index, an object tolerated) → `name`
 *   - location: `city.name` + `city.country_name`, with "Remote" appended when
 *               `is_remote` is truthy
 *   - postedAt: `published_at` (naive stamp, read as UTC)
 *   - description: `description`, flattened from HTML for content_filter
 *
 * @param {any} hit
 * @param {string} [fallbackCompany]
 * @param {Set<string>} [sharedLinks] — external links used by more than one posting
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number } | null}
 */
export function normalizeTechInAsiaJob(hit, fallbackCompany, sharedLinks) {
  if (!hit || typeof hit !== 'object') return null;

  const title = typeof hit.title === 'string' ? hit.title.trim() : '';
  if (!title) return null;

  const url = resolveTechInAsiaUrl(hit, sharedLinks);
  if (!url) return null; // no id and no external link → nothing to dedup or link

  // `company` travels as a JSON-encoded string in the index; tolerate a real
  // object too so a payload change is a non-event.
  let companyName = '';
  const raw = hit.company;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string') companyName = parsed.name.trim();
    } catch {
      // not JSON → leave empty, fall back below
    }
  } else if (raw && typeof raw === 'object' && typeof raw.name === 'string') {
    companyName = raw.name.trim();
  }
  const company = companyName || (typeof fallbackCompany === 'string' ? fallbackCompany : '') || 'Tech in Asia';

  const parts = [];
  const city = hit.city;
  if (city && typeof city === 'object') {
    for (const key of ['name', 'country_name']) {
      const v = typeof city[key] === 'string' ? city[key].trim() : '';
      if (v && !parts.includes(v)) parts.push(v);
    }
  }
  if (hit.is_remote) parts.push('Remote');

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const out = { title, url, company, location: parts.join(', ') };

  const description = htmlToText(hit.description);
  if (description) out.description = description;

  const postedAt = parsePublishedAt(hit.published_at);
  if (postedAt != null) out.postedAt = postedAt;

  return out;
}

/** Resolve an optional Algolia credential override from the entry. */
function resolveCredentialOverride(entry, key) {
  const cfg = entry?.techinasia && typeof entry.techinasia === 'object' ? entry.techinasia : {};
  const v = cfg[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

/** @type {Provider} */
export default {
  id: 'techinasia',

  detect(_entry) {
    // Tech in Asia is a job board aggregator, not a company ATS.
    // Auto-detection is intentionally not supported —
    // use `provider: techinasia` explicitly in portals.yml.
    return null;
  },

  async fetch(entry, ctx) {
    // 1. Discover the Algolia credentials from the live build (rule: rotate-safe).
    //    An explicit override on the entry short-circuits this when the site's
    //    markup changes shape and discovery needs a stopgap.
    let appId = resolveCredentialOverride(entry, 'appId');
    let apiKey = resolveCredentialOverride(entry, 'apiKey');
    if (!appId || !apiKey) {
      const html = await ctx.fetchText(assertHost(SEARCH_PAGE_URL, 'www.techinasia.com', 'search page'), {
        redirect: 'error',
      });
      const assetUrl = findAppAssetPath(html);
      const js = await ctx.fetchText(assetUrl, { redirect: 'error' });
      const discovered = parseAlgoliaCredentials(js);
      appId = appId || discovered.appId;
      apiKey = apiKey || discovered.apiKey;
    }

    if (!/^[A-Za-z0-9]{16,64}$/.test(apiKey)) {
      throw new Error('techinasia: unexpected Algolia client key shape');
    }
    const endpoint = algoliaEndpoint(appId, apiKey);

    const maxPages = Math.min(
      Number.isInteger(entry?.maxPages) && entry.maxPages > 0 ? entry.maxPages : DEFAULT_MAX_PAGES,
      MAX_PAGES_CAP,
    );
    const fallbackCompany = typeof entry?.name === 'string' ? entry.name : '';

    const out = [];
    const seen = new Set();
    // Every hit is collected before any is normalized: deciding whether a link
    // belongs to one posting or to a batch of them needs the whole board in hand.
    const hits = [];

    for (let page = 0; page < maxPages; page++) {
      const body = JSON.stringify({
        requests: [{ indexName: INDEX, params: `query=&hitsPerPage=${HITS_PER_PAGE}&page=${page}` }],
      });
      const json = /** @type {any} */ (
        await ctx.fetchJson(endpoint, {
          method: 'POST',
          // The site sends this content-type with a JSON body; matching it keeps
          // the request byte-equivalent to the one the board's own UI makes.
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
            referer: `${SITE_ORIGIN}/`,
          },
          body,
          redirect: 'error',
        })
      );

      const result = json?.results?.[0];
      if (!result || !Array.isArray(result.hits)) {
        throw new Error(
          `techinasia: unexpected Algolia response on page ${page} — expected results[0].hits, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }

      hits.push(...result.hits);

      const nbPages = Number.isFinite(result.nbPages) ? result.nbPages : 1;
      if (result.hits.length === 0 || page + 1 >= nbPages) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Links appearing on more than one posting are not a single posting's path.
    const linkCounts = new Map();
    for (const hit of hits) {
      const link = externalLinkOf(hit);
      if (link) linkCounts.set(link, (linkCounts.get(link) || 0) + 1);
    }
    const sharedLinks = new Set([...linkCounts].filter(([, n]) => n > 1).map(([link]) => link));

    for (const hit of hits) {
      const normalized = normalizeTechInAsiaJob(hit, fallbackCompany, sharedLinks);
      if (!normalized || seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      out.push(normalized);
    }

    return out;
  },
};
