// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ALDI Nord provider — single-company (pattern: ibm/dassault/rheinmetall), for
// `tracked_companies:` entries. It reads the job search API of the ALDI Nord
// group's own country sites: the same Next.js front on every host below calls
//
//   POST https://{host}/api/job/hr/query
//   {"careerLevelIds":[],"jobTypeParams":{"jobTypeIds":[]},"jobCategoryIds":[...],
//    "title":"","location":{"searchPhrase":""},"page":N,"locale":"de-DE"}
//   → {"total":N,"hasNextPage":true,"page":N,"locale":"de-DE","results":[...]}
//
// No cookie, token or login. The backend is shared: `locale` alone selects the
// country's postings, so each host is asked only for its own locales (an
// unknown locale answers an empty 200, which is why the provider validates it
// rather than the server). Belgium serves two separate posting sets, nl-BE and
// fr-BE, and both are read by default. The provider sends no `channelId`:
// www.aldi.pl's own page does, and that hides the IT postings of a second
// channel whose posting pages on www.aldi.pl are live.
//
// `page` is cumulative, the way the site's "show more" button uses it: page N
// returns the first 10·N rows, and a page at or past the end returns all of
// them with hasNextPage false. So a walk is never one request per 10 rows. The
// provider asks for page 1 (the probe page, and the source's `total`), then for
// the page that covers `total`, bounded by max_pages: two list requests per
// locale on a full scan. Rows added to the list between those two requests wait
// for the next scan. A second response with no more than 10 rows while more
// were promised means the parameter is no longer cumulative; the first page is
// kept and a warning says so.
//
// One posting page per row: https://{host}{detail path}{slugTitle}-{postingId}.html,
// the link the site's own job card carries. The list has no description and
// no requisition number (both are only on the per-posting detail API, which
// this provider does not call), so `description` and `requisitionId` are
// never set; `language` is the locale the response echoes.
//
// The provider reads only /api/job/hr/query, and the posting URLs it returns
// carry no query. robots.txt under `User-agent: *` disallows neither; it does
// disallow the apply pages (?jobId=), which the provider never requests.
//
// Entry config (all optional):
//   aldi_nord:
//     locales: [nl-BE]          # default: every locale of the host
//     categories: ['10420']     # jobCategoryIds; default: all categories
// max_pages counts 10-row pages (default DEFAULT_MAX_PAGES, at most MAX_PAGES_CAP).

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

/**
 * The confirmed country sites: each host's locales and the path its job cards
 * link a posting under. www.aldi.dk is not here: it does not serve the API.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const SITES = Object.freeze({
  'www.aldi-nord.de': Object.freeze({ 'de-DE': '/karriere/detail/' }),
  'www.aldi.nl': Object.freeze({ 'nl-NL': '/carriere/detail/' }),
  'www.aldi.be': Object.freeze({ 'nl-BE': '/jobs/detail/', 'fr-BE': '/fr/jobs/detail/' }),
  'www.aldi.lu': Object.freeze({ 'fr-LU': '/jobs/detail/' }),
  'www.aldi.fr': Object.freeze({ 'fr-FR': '/carriere/detail/' }),
  'www.aldi.es': Object.freeze({ 'es-ES': '/empleo/detail/' }),
  'www.aldi.pt': Object.freeze({ 'pt-PT': '/carreira/detail/' }),
  'www.aldi.pl': Object.freeze({ 'pl-PL': '/praca/detail/' }),
});

const PAGE_SIZE = 10; // fixed by the API; size/limit fields in the body are ignored
// 500 pages = 5,000 postings, above the list of www.aldi-nord.de, the largest
// site, which comes back in one response of a few MB.
const DEFAULT_MAX_PAGES = 500;
// 1,000 pages = 10,000 postings, about 11 MB at the ~1.1 KB a row measured:
// past ~9,000 postings the entry also needs max_response_mb.
const MAX_PAGES_CAP = 1000;
const INTER_REQUEST_DELAY_MS = 250;
// One response can carry a whole country list of a few MB, so the default 10 s
// is raised.
const LIST_TIMEOUT_MS = 30_000;

/**
 * @param {unknown} raw
 * @returns {string | null} the www host of a confirmed ALDI Nord site, or null
 */
export function resolveSiteHost(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const www = host.startsWith('www.') ? host : `www.${host}`;
  return Object.hasOwn(SITES, www) ? www : null;
}

/** @param {any} entry */
function entryUrl(entry) {
  if (typeof entry?.careers_url === 'string' && entry.careers_url) return entry.careers_url;
  if (typeof entry?.api === 'string' && entry.api) return entry.api;
  return null;
}

/** @param {any} entry */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Reads the `aldi_nord:` block. A wrong value throws: a typo would otherwise
 * read as an empty board (unknown locale) or a 502 (non-numeric id).
 * @param {any} entry
 * @param {string} host
 * @returns {{ locales: string[], categories: string[] }}
 */
export function resolveConfig(entry, host) {
  const cfg = entry?.aldi_nord ?? {};
  if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('aldi-nord: aldi_nord must be a mapping');
  const known = Object.keys(SITES[host]);

  let locales = known;
  if (cfg.locales !== undefined) {
    if (!Array.isArray(cfg.locales) || cfg.locales.length === 0) {
      throw new Error(`aldi-nord: aldi_nord.locales must be a non-empty list (${host} serves ${known.join(', ')})`);
    }
    locales = [];
    for (const raw of cfg.locales) {
      const match = known.find((k) => typeof raw === 'string' && k.toLowerCase() === raw.trim().toLowerCase());
      if (!match) throw new Error(`aldi-nord: locale ${JSON.stringify(raw)} is not served by ${host} (${known.join(', ')})`);
      if (!locales.includes(match)) locales.push(match);
    }
  }

  let categories = [];
  if (cfg.categories !== undefined) {
    if (!Array.isArray(cfg.categories)) throw new Error('aldi-nord: aldi_nord.categories must be a list of category ids');
    for (const raw of cfg.categories) {
      const id = typeof raw === 'number' || typeof raw === 'string' ? String(raw).trim() : '';
      if (!/^\d+$/.test(id)) throw new Error(`aldi-nord: category ${JSON.stringify(raw)} is not a numeric jobCategoryId`);
      if (!categories.includes(id)) categories.push(id);
    }
  }
  return { locales, categories };
}

/**
 * @param {string} locale
 * @param {string[]} categories
 * @param {number} page
 */
export function buildQueryBody(locale, categories, page) {
  return JSON.stringify({
    careerLevelIds: [],
    jobTypeParams: { jobTypeIds: [] },
    jobCategoryIds: categories,
    title: '',
    location: { searchPhrase: '' },
    page,
    locale,
  });
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Distinct cities, then the country once when every location shares it
 * ("Kamen / Bergkamen, Germany"); otherwise "City, Country" per place joined
 * with "; ". The street, zip code and region are left out.
 * @param {unknown} locations
 */
export function formatLocation(locations) {
  /** @type {{ city: string, country: string }[]} */
  const places = [];
  for (const l of Array.isArray(locations) ? locations : []) {
    const city = text(l?.city);
    const country = text(l?.country);
    if (!city && !country) continue;
    if (!places.some((p) => p.city === city && p.country === country)) places.push({ city, country });
  }
  if (places.length === 0) return '';
  const countries = [...new Set(places.map((p) => p.country).filter(Boolean))];
  if (countries.length <= 1) {
    const cities = [...new Set(places.map((p) => p.city).filter(Boolean))];
    return [cities.join(' / '), countries[0]].filter(Boolean).join(', ');
  }
  return places.map((p) => [p.city, p.country].filter(Boolean).join(', ')).join('; ');
}

/**
 * One response → its rows and the source's own counts. A body that is not
 * the documented envelope throws; a bad row is skipped.
 * @param {any} json
 * @param {{ host: string, detailPath: string, locale: string, company: string }} site
 */
export function parseQueryResponse(json, site) {
  const rows = json && typeof json === 'object' && Array.isArray(json.results) ? json.results : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`aldi-nord: unexpected response — expected results[], got: [${got}]`);
  }
  const language = text(json.locale) || site.locale;
  const jobs = [];
  for (const row of rows) {
    const title = text(row?.title);
    const slug = typeof row?.slugTitle === 'string' ? safeEncodeURIComponent(row.slugTitle.trim()) : null;
    const id = typeof row?.postingId === 'string' || typeof row?.postingId === 'number'
      ? safeEncodeURIComponent(String(row.postingId).trim())
      : null;
    if (!title || !slug || !id) continue;
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://${site.host}${site.detailPath}${slug}-${id}.html`,
      company: site.company,
      location: formatLocation(row.locations),
      language,
    };
    const postedAt = toEpochMs(row.onlineFrom);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  const total = Number.isInteger(json.total) && json.total >= 0 ? json.total : null;
  return { jobs, rawCount: rows.length, total, hasNextPage: json.hasNextPage === true };
}

/** @type {Provider} */
export default {
  id: 'aldi-nord',

  detect(entry) {
    const url = entryUrl(entry);
    return url && resolveSiteHost(url) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveSiteHost(entryUrl(entry));
    if (!host) throw new Error(`aldi-nord: ${entry?.name ?? '(unnamed)'} is not on an ALDI Nord careers host (${Object.keys(SITES).join(', ')})`);
    const { locales, categories } = resolveConfig(entry, host);
    const company = text(entry?.name) || 'ALDI Nord';
    const apiUrl = `https://${host}/api/job/hr/query`;

    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = Number.isInteger(ctxMaxPages) && ctxMaxPages > 0;
    const pageBudget = probing ? Math.min(maxPages, ctxMaxPages) : maxPages;

    /** @param {string} locale @param {number} page */
    const request = (locale, page) => fetchJsonWithRetry(ctx, apiUrl, {
      method: 'POST',
      redirect: 'error',
      timeoutMs: LIST_TIMEOUT_MS,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: buildQueryBody(locale, categories, page),
    });

    const jobs = [];
    const seen = new Set();
    /** @type {'cap' | 'fetch-error' | 'not-cumulative' | null} */
    let truncatedReason = null; // a broken locale takes precedence over a capped one
    let requests = 0;

    // A probe only needs to know the board answers: the first locale is enough.
    for (const locale of probing ? locales.slice(0, 1) : locales) {
      const site = { host, detailPath: SITES[host][locale], locale, company };
      if (requests > 0) await sleep(INTER_REQUEST_DELAY_MS, ctx);
      requests++;
      // Page 1 is not caught: a locale whose first request fails is a broken
      // board, not a short one.
      let result = parseQueryResponse(await request(locale, 1), site);
      let page = 1;
      /** @type {'complete' | 'cap' | 'fetch-error' | 'not-cumulative'} */
      let stopReason = 'complete';

      if (result.hasNextPage && page < pageBudget) {
        const covering = result.total !== null ? Math.ceil(result.total / PAGE_SIZE) : pageBudget;
        const next = Math.min(Math.max(covering, page + 1), pageBudget);
        await sleep(INTER_REQUEST_DELAY_MS, ctx);
        requests++;
        try {
          const nextResult = parseQueryResponse(await request(locale, next), site);
          if (nextResult.rawCount <= PAGE_SIZE && result.rawCount === PAGE_SIZE) {
            stopReason = 'not-cumulative';
            console.error(`⚠️  aldi-nord: ${company} (${locale}) page ${next} returned no more rows than page 1 — the API no longer treats page as cumulative; kept the first ${result.rawCount} of ${result.total ?? '?'} postings`);
          } else {
            result = nextResult;
            page = next;
          }
        } catch (err) {
          // verify-portals reads its own budget error by identity.
          if (probing) throw err;
          stopReason = 'fetch-error';
          const hint = /** @type {any} */ (err)?.code === 'response_too_large' ? ' — set max_response_mb on this entry' : '';
          console.error(`⚠️  aldi-nord: ${company} (${locale}) kept the first ${result.rawCount} of ${result.total ?? '?'} postings: ${/** @type {any} */ (err)?.message ?? err}${hint}`);
        }
      }

      // A short or final page wins over the cap: only a full page that the
      // source says is not the last is a truncation. A probe's own page
      // budget is not the entry's cap and never warns.
      if (!probing && stopReason === 'complete' && page === maxPages && result.hasNextPage && result.rawCount >= page * PAGE_SIZE) {
        stopReason = 'cap';
        console.error(`⚠️  aldi-nord: ${company} (${locale}) truncated at max_pages=${maxPages} (${result.rawCount} of ${result.total ?? '?'} postings) — narrow aldi_nord.categories or raise max_pages on this entry`);
      }
      if (stopReason !== 'complete' && (truncatedReason === null || truncatedReason === 'cap')) truncatedReason = stopReason;

      for (const job of result.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
    }

    if (truncatedReason) /** @type {any} */ (jobs).aldiNordTruncated = truncatedReason;
    return jobs;
  },
};
