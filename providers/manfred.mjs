// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// getManfred provider — board-wide public JSON feed of Spanish/EU tech jobs
// (https://www.getmanfred.com/api/v2/public/offers). Public, zero-auth, and
// returned in ONE call: the endpoint has no pagination parameters and answers
// with the full catalogue.
//
// Two things measured against the live feed on 2026-08-03 shape this provider:
//
//   1. The feed is a CATALOGUE, NOT A LIVE BOARD. 1,604 of its 1,628 entries
//      carry `status: "CLOSED"`; only 24 were ACTIVE. Ingesting it unfiltered
//      would push ~1.6k dead postings into the pipeline on the first scan, so
//      the status filter is not an optimization here — it is the difference
//      between a usable provider and an unusable one.
//   2. `lang` is REQUIRED: without it the API answers 400 with
//      `"lang must be one of the following values: EN, ES"`.
//
// Wire in via a `job_boards:` entry with `provider: manfred`.

const FEED_BASE = 'https://www.getmanfred.com/api/v2/public/offers';
const TRUSTED_HOST = 'www.getmanfred.com';
const OFFER_BASE = 'https://www.getmanfred.com/ofertas-empleo';
const VALID_LANGS = ['EN', 'ES'];
const DEFAULT_LANG = 'EN';

/** @param {string} url */
function assertManfredUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`manfred: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`manfred: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`manfred: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the feed language: `lang` on the entry, uppercased, else EN. */
export function resolveLang(entry) {
  const raw = typeof entry?.lang === 'string' ? entry.lang.trim().toUpperCase() : '';
  return VALID_LANGS.includes(raw) ? raw : DEFAULT_LANG;
}

// The feed reports currency as the SYMBOL, not an ISO code, and the observed
// values include a narrow-no-break-space variant of the euro sign. scan.mjs's
// salary_filter compares currencies case-insensitively as plain strings, so a
// symbol would never match a user's `currency: EUR` — map to ISO, and drop the
// field entirely rather than guess when the symbol is unknown.
const CURRENCY_BY_SYMBOL = new Map([
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['US$', 'USD'],
  ['$', 'USD'],
  ['MXN$', 'MXN'],
]);

/** @param {unknown} raw */
export function normalizeCurrency(raw) {
  if (typeof raw !== 'string') return '';
  //   (narrow no-break space) and friends appear glued to the symbol in
  // the live feed; strip every space class before the lookup.
  const cleaned = raw.replace(/[\s  ]/g, '').toUpperCase();
  for (const [symbol, iso] of CURRENCY_BY_SYMBOL) {
    if (cleaned === symbol.toUpperCase()) return iso;
  }
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : '';
}

/**
 * The feed URL, built in ONE place: detect() reports it and fetch() requests
 * it, so building it twice would let the reported URL drift from the one
 * actually called the day a second query parameter is added.
 *
 * @param {any} entry
 * @returns {string}
 */
function buildFeedUrl(entry) {
  return `${FEED_BASE}?lang=${resolveLang(entry)}`;
}

/**
 * Build the `{min, max, currency}` shape scan.mjs's salary_filter consumes.
 * Returns null when the offer carries no usable figure, which the filter
 * treats as "no data" and passes.
 *
 * @param {any} offer
 * @returns {{min: number, max: number, currency: string}|null}
 */
export function parseCompensation(offer) {
  const from = Number(offer?.salaryFrom);
  const to = Number(offer?.salaryTo);
  const min = Number.isFinite(from) && from > 0 ? from : null;
  const max = Number.isFinite(to) && to > 0 ? to : null;
  if (min === null && max === null) return null;
  return {
    min: min ?? /** @type {number} */ (max),
    max: max ?? /** @type {number} */ (min),
    currency: normalizeCurrency(offer?.currency),
  };
}

/**
 * Location for an offer.
 *
 * `locations` is a plain string array ("Madrid, Spain") and is empty on 932 of
 * the 1,628 entries measured. For those, `remotePercentage` is the only place
 * signal there is — and remote and hybrid are kept DISTINGUISHABLE rather than
 * collapsed into "Remote", because the emitted string is what `location_filter`
 * matches on: collapsing them makes a `block: ["Hybrid"]` rule unmatchable
 * (same failure as #2258 in the echojobs provider).
 *
 * A placeless on-site offer (0%) keeps "", which passes the filter under the
 * scanner's "don't penalize missing data" convention.
 *
 * @param {any} offer
 * @returns {string}
 */
export function resolveLocation(offer) {
  const listed = Array.isArray(offer?.locations)
    ? offer.locations.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim())
    : [];
  if (listed.length > 0) return listed.join(', ');

  const remote = Number(offer?.remotePercentage);
  if (!Number.isFinite(remote)) return '';
  if (remote >= 100) return 'Remote';
  if (remote > 0) return 'Hybrid';
  return '';
}

/**
 * Normalize a single offer. Exported for tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `position`, trimmed (offers without one are dropped).
 *   - url:      built from `id` and `slug` as `/ofertas-empleo/{id}/{slug}` —
 *               the canonical form published in the site's own
 *               sitemap-offers.xml. An offer missing either part is dropped
 *               rather than linked to a guessed URL, since url is the dedup key.
 *   - company:  `company.name`, falling back to the portal entry name.
 *   - location: see resolveLocation.
 *   - salary:   `salaryFrom`/`salaryTo`/`currency` → `{min, max, currency}`.
 *
 * NO postedAt: the only timestamp in the payload is `updatedAt`, which is a
 * modification time, not a publication date. Mapping it to postedAt would make
 * an edited old posting look freshly published to the recency filters, so the
 * field is omitted — the Job contract explicitly allows that.
 *
 * @param {any} offer
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, salary?: {min:number,max:number,currency:string} } | null}
 */
export function normalizeManfredOffer(offer, fallbackCompany) {
  if (!offer || typeof offer !== 'object') return null;
  if (offer.status !== 'ACTIVE') return null;

  const title = typeof offer.position === 'string' ? offer.position.trim() : '';
  if (!title) return null;

  const id = Number(offer.id);
  const slug = typeof offer.slug === 'string' ? offer.slug.trim() : '';
  if (!Number.isInteger(id) || id <= 0 || !slug) return null;
  const url = `${OFFER_BASE}/${id}/${encodeURIComponent(slug)}`;

  const company =
    typeof offer.company?.name === 'string' && offer.company.name.trim()
      ? offer.company.name.trim()
      : fallbackCompany || 'getManfred';

  /** @type {{ title: string, url: string, company: string, location: string, salary?: {min:number,max:number,currency:string} }} */
  const job = { title, url, company, location: resolveLocation(offer) };
  const salary = parseCompensation(offer);
  if (salary) job.salary = salary;
  return job;
}

/** @type {Provider} */
export default {
  id: 'manfred',

  detect(entry) {
    return entry?.provider === 'manfred' ? { url: buildFeedUrl(entry) } : null;
  },

  async fetch(entry, ctx) {
    // Validate the URL actually fetched (not just a constant) so the host pin
    // is meaningful, then redirect:'error' blocks SSRF via server-side
    // redirects — together they keep the request on getmanfred.com.
    const url = assertManfredUrl(buildFeedUrl(entry));
    const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
    if (!Array.isArray(json)) {
      throw new Error(
        `manfred: unexpected API response — expected a JSON array of offers, got ${json === null ? 'null' : typeof json}`,
      );
    }
    const fallbackCompany = entry?.name;
    const out = [];
    for (const offer of json) {
      const normalized = normalizeManfredOffer(offer, fallbackCompany);
      if (normalized) out.push(normalized);
    }
    return out;
  },
};
