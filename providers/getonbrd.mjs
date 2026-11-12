// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Get on Board provider — board-wide category feeds
// (https://www.getonbrd.com/api/v0/categories/{category}/jobs). Public,
// zero-auth JSON:API. `expand[]=company` embeds the company so its name is
// available at the list level. The broad category feed is fetched (not the
// server-side ?query= search, which requires a query and narrows results) so
// scan.mjs's title_filter can gate on the configured titles instead. Pages are
// fetched until one comes back short/empty or the page cap is reached (default
// 3, override with `max_pages` on the portal entry).
//
// Category defaults to `programming`. Override with `category: <slug>` or scan
// several in one entry with `categories: [<slug>, ...]` — the board splits
// leadership and ML/data roles out of `programming`, so an EM/Tech Lead search
// misses most of its matches without `operations-management` and
// `machine-learning-ai`. Jobs are deduped by URL across categories (a posting
// can be listed in more than one).
//
// Wire in via a `job_boards:` entry with `provider: getonbrd`.

const FEED_HOST = 'https://www.getonbrd.com';
const TRUSTED_HOST = 'www.getonbrd.com';
const DEFAULT_CATEGORY = 'programming';
// Category slugs are lowercase alphanumeric words joined by single hyphens.
// Anchored so a config typo can never inject a path segment or query into the
// feed URL (`../`, `?`, `//host`); the host assert below is the second gate.
const CATEGORY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;
const MAX_CATEGORIES = 12;

/** Build the feed base URL for one category slug. */
function feedBase(category) {
  return `${FEED_HOST}/api/v0/categories/${category}/jobs`;
}

/**
 * Resolve the categories to scan, in config order, deduped.
 *
 * `categories:` (array) wins over `category:` (string); neither → the
 * `programming` default, which keeps pre-existing entries byte-identical.
 * Exported for tests.
 *
 * @param {any} entry
 * @returns {string[]}
 */
export function resolveCategories(entry) {
  const raw = entry?.categories !== undefined ? entry.categories : entry?.category;
  if (raw === undefined || raw === null) return [DEFAULT_CATEGORY];

  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const c of list) {
    if (typeof c !== 'string' || !CATEGORY_SLUG_RE.test(c.trim())) {
      throw new Error(
        `getonbrd: invalid category ${JSON.stringify(c)} — expected a slug like "programming" or "machine-learning-ai"`,
      );
    }
    const slug = c.trim();
    if (!out.includes(slug)) out.push(slug);
  }
  if (!out.length) {
    throw new Error('getonbrd: `categories` is empty — omit it to use the "programming" default');
  }
  if (out.length > MAX_CATEGORIES) {
    throw new Error(
      `getonbrd: ${out.length} categories configured — cap is ${MAX_CATEGORIES} (each one costs up to max_pages requests)`,
    );
  }
  return out;
}

/** @param {string} url */
function assertGetonbrdUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`getonbrd: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`getonbrd: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`getonbrd: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Normalize a single Get on Board job (JSON:API resource). Exported for tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `attributes.title`, trimmed (items without one are dropped).
 *   - url:      `links.public_url` — an absolute `https:` posting URL host-locked
 *               to www.getonbrd.com (off-host or non-https drops the item). It is
 *               the dedup key and is display-only (never server-fetched here).
 *   - company:  `attributes.company.data.attributes.name` (from `expand[]=company`),
 *               falling back to the portal entry name, then "Get on Board".
 *   - location: "Remote" when `attributes.remote` is true, else the joined
 *               `attributes.countries` (an array of country names in the live
 *               API; a plain string is tolerated for older payloads).
 *   - postedAt: `attributes.published_at` (epoch SECONDS) → epoch ms (omitted when absent).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeGetonbrdJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object' || !j.attributes || typeof j.attributes !== 'object') return null;
  const attr = j.attributes;

  const title = typeof attr.title === 'string' ? attr.title.trim() : '';
  if (!title) return null;

  // url must be an absolute https posting link on www.getonbrd.com.
  let url = '';
  const rawUrl = j.links && typeof j.links.public_url === 'string' ? j.links.public_url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const name = attr.company?.data?.attributes?.name;
  const company =
    typeof name === 'string' && name.trim() ? name.trim() : fallbackCompany || 'Get on Board';

  // `attributes.countries` is an array of country names in the live API (e.g.
  // ["Chile"]); older/edge payloads may send a plain string. Handle both.
  let location = '';
  if (attr.remote === true) {
    location = 'Remote';
  } else if (Array.isArray(attr.countries)) {
    location = attr.countries
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim())
      .join(', ');
  } else if (typeof attr.countries === 'string') {
    location = attr.countries.trim();
  }

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  // `attributes.published_at` is epoch SECONDS → convert to ms (omitted when absent).
  if (Number.isFinite(attr.published_at) && attr.published_at > 0) job.postedAt = attr.published_at * 1000;
  return job;
}

/** @type {Provider} */
export default {
  id: 'getonbrd',

  async fetch(entry, ctx) {
    const categories = resolveCategories(entry);
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];
    // A posting can appear under several categories; first sighting wins so the
    // scanner never sees the same URL twice from one entry.
    const seen = new Set();

    for (const category of categories) {
      const base = assertGetonbrdUrl(feedBase(category));

      for (let page = 1; page <= maxPages; page++) {
        const url = `${base}?per_page=${PER_PAGE}&expand[]=company&page=${page}`;
        // redirect:'error' prevents SSRF via server-side redirects
        const json = await ctx.fetchJson(url, { redirect: 'error' });
        if (!json || !Array.isArray(json.data)) {
          throw new Error(
            `getonbrd: unexpected API response for category "${category}" on page ${page} — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
          );
        }
        for (const j of json.data) {
          const normalized = normalizeGetonbrdJob(j, fallbackCompany);
          if (!normalized || seen.has(normalized.url)) continue;
          seen.add(normalized.url);
          out.push(normalized);
        }
        if (json.data.length < PER_PAGE) break; // short page → last page reached
      }
    }
    return out;
  },
};
