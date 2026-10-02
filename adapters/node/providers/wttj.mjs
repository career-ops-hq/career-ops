// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Welcome to the Jungle provider — queries WTTJ's public Algolia search index
// (the same one the welcometothejungle.com jobs UI calls). The Algolia app id
// and client search key are public but rotate, so they are fetched fresh from
// https://www.welcometothejungle.com/api/env on every run instead of being
// hardcoded. The key is referer-locked, so every Algolia request sends a
// welcometothejungle.com Referer header.
//
// The board is global and enormous, so a `wttj:` config block with explicit
// search queries is REQUIRED — without one the provider throws rather than
// silently scanning an arbitrary slice:
//
//   - name: Welcome to the Jungle
//     provider: wttj
//     wttj:
//       queries: ["finops", "data platform engineer", "snowflake"]
//       max_hits: 100        # optional, per query, capped at 200
//     enabled: true
//
// Each hit maps to the normalized Job shape; salary_yearly_minimum (when
// present) is attached as `salary: {min, max, currency}` so scan.mjs's
// salary_filter can gate on it.

const ENV_URL = 'https://www.welcometothejungle.com/api/env';
const SITE_ORIGIN = 'https://www.welcometothejungle.com';
const INDEX = 'wttj_jobs_production_en';
const DEFAULT_MAX_HITS = 100;
const MAX_HITS_CAP = 200;

/** Pin a URL to an expected https host. */
function assertHost(url, host, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`wttj: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`wttj: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== host.toLowerCase()) {
    throw new Error(`wttj: untrusted ${label} hostname "${parsed.hostname}" — must be ${host}`);
  }
  return url;
}

/**
 * Parse the `window.env = {...}` payload served by /api/env and extract the
 * Algolia application id + client search key.
 * @param {string} text
 * @returns {{ appId: string, apiKey: string }}
 */
export function parseEnvPayload(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('wttj: /api/env payload has no JSON object');
  let env;
  try {
    env = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('wttj: /api/env payload is not valid JSON');
  }
  const appId = typeof env.PUBLIC_ALGOLIA_APPLICATION_ID === 'string' ? env.PUBLIC_ALGOLIA_APPLICATION_ID.trim() : '';
  const apiKey = typeof env.PUBLIC_ALGOLIA_API_KEY_CLIENT === 'string' ? env.PUBLIC_ALGOLIA_API_KEY_CLIENT.trim() : '';
  // App ids are short alphanumerics; validating keeps the derived Algolia
  // hostname from being attacker-shaped if the env payload ever changes.
  if (!/^[A-Z0-9]{6,16}$/i.test(appId)) throw new Error(`wttj: unexpected Algolia app id "${appId}"`);
  // The key is only ever sent as a request header (never used to build a
  // host), so don't over-constrain its format — WTTJ may rotate to a longer
  // or non-hex (e.g. secured/base64) client key. Length bounds only.
  if (!apiKey || apiKey.length < 16 || apiKey.length > 500) {
    throw new Error('wttj: unexpected Algolia api key shape');
  }
  return { appId, apiKey };
}

/**
 * Normalize a single Algolia hit. Exported for tests.
 *
 * Field mapping → normalized Job shape:
 *   - title:    `name`
 *   - url:      /en/companies/{organization.slug}/jobs/{slug} on the WTTJ site
 *   - company:  `organization.name`
 *   - location: offices[0] city+country, with ", Remote" appended when the
 *               posting allows fulltime remote
 *   - postedAt: `published_at_timestamp` (epoch seconds → ms)
 *   - salary:   {min, max, currency} from salary_yearly_minimum/salary_maximum
 *
 * @param {any} h
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string} } | null}
 */
export function normalizeWttjHit(h) {
  if (!h || typeof h !== 'object') return null;
  const title = typeof h.name === 'string' ? h.name.trim() : '';
  const slug = typeof h.slug === 'string' ? h.slug.trim() : '';
  const orgSlug = typeof h.organization?.slug === 'string' ? h.organization.slug.trim() : '';
  if (!title || !slug || !orgSlug) return null;
  // Slugs feed straight into a URL path — keep them to safe path characters.
  if (!/^[a-z0-9_-]+$/i.test(slug) || !/^[a-z0-9_-]+$/i.test(orgSlug)) return null;

  const url = `${SITE_ORIGIN}/en/companies/${orgSlug}/jobs/${slug}`;
  const company =
    typeof h.organization?.name === 'string' && h.organization.name.trim()
      ? h.organization.name.trim()
      : 'Welcome to the Jungle';

  const office = Array.isArray(h.offices) && h.offices.length > 0 ? h.offices[0] : null;
  const parts = [];
  if (office && typeof office.city === 'string' && office.city.trim()) parts.push(office.city.trim());
  if (office && typeof office.country === 'string' && office.country.trim()) parts.push(office.country.trim());
  if (h.remote === 'fulltime') parts.push('Remote');
  const location = parts.join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string} }} */
  const job = { title, url, company, location };

  const ts = h.published_at_timestamp;
  if (Number.isFinite(ts) && ts > 0) job.postedAt = ts * 1000;

  const min = Number.isFinite(h.salary_yearly_minimum) && h.salary_yearly_minimum > 0 ? h.salary_yearly_minimum : 0;
  // salary_maximum is per salary_period; only trust it as an annual bound when
  // the period is yearly — otherwise keep just the annualized minimum.
  const max =
    h.salary_period === 'yearly' && Number.isFinite(h.salary_maximum) && h.salary_maximum > 0
      ? h.salary_maximum
      : 0;
  if (min || max) {
    job.salary = {
      min: min || max,
      max: max || min,
      currency: typeof h.salary_currency === 'string' ? h.salary_currency.trim().toUpperCase() : '',
    };
  }
  return job;
}

/** Resolve config: required queries list + optional per-query hit cap. */
function resolveConfig(entry) {
  const cfg = entry?.wttj && typeof entry.wttj === 'object' ? entry.wttj : {};
  const queries = Array.isArray(cfg.queries)
    ? cfg.queries.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim())
    : [];
  if (queries.length === 0) {
    throw new Error(
      'wttj: the WTTJ board is global — configure explicit searches via `wttj: { queries: ["…"] }`',
    );
  }
  const maxHits =
    Number.isInteger(cfg.max_hits) && cfg.max_hits > 0 ? Math.min(cfg.max_hits, MAX_HITS_CAP) : DEFAULT_MAX_HITS;
  return { queries, maxHits };
}

/** @type {Provider} */
export default {
  id: 'wttj',

  detect(entry) {
    return entry?.provider === 'wttj' ? { url: SITE_ORIGIN } : null;
  },

  async fetch(entry, ctx) {
    const { queries, maxHits } = resolveConfig(entry);

    // 1. Fresh Algolia credentials from the site's public env endpoint.
    const envText = await ctx.fetchText(assertHost(ENV_URL, 'www.welcometothejungle.com', 'env'), {
      redirect: 'error',
    });
    const { appId, apiKey } = parseEnvPayload(envText);
    const algoliaHost = `${appId}-dsn.algolia.net`;

    // 2. One Algolia query per configured search term; dedup across queries.
    const byUrl = new Map();
    for (const query of queries) {
      const url = assertHost(
        `https://${algoliaHost}/1/indexes/${INDEX}/query`,
        algoliaHost,
        'algolia',
      );
      const params = new URLSearchParams({
        query,
        hitsPerPage: String(maxHits),
        attributesToRetrieve:
          'name,slug,organization,offices,remote,published_at_timestamp,salary_yearly_minimum,salary_maximum,salary_period,salary_currency',
      });
      const json = /** @type {any} */ (
        await ctx.fetchJson(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'x-algolia-application-id': appId,
            'x-algolia-api-key': apiKey,
            // The client search key is referer-locked to the WTTJ site.
            referer: `${SITE_ORIGIN}/`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ params: params.toString() }),
        })
      );
      if (!json || !Array.isArray(json.hits)) {
        throw new Error(
          `wttj: unexpected Algolia response for query "${query}" — expected { hits: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const h of json.hits) {
        const job = normalizeWttjHit(h);
        if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
      }
    }
    return [...byUrl.values()];
  },
};
