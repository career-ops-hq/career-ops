// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JustJoin.it provider — hits the current candidate offers API.
// Browser URLs under https://justjoin.it/job-offers/... are accepted for
// detection, but fetches use https://justjoin.it/api/candidate-api/offers.
//
// Optional entry settings, both off by default:
//   workplace: [remote]        keep only these workplaceType values
//                              (remote, hybrid, office)
//   open_to_ukrainians: true   keep only offers whose employer set
//                              isOpenToHireUkrainians
//   max_polish_level: B1       drop offers that ask for Polish above this CEFR
//                              level (A1..C2). Offers that list no language, or
//                              no Polish, are kept: the field is often empty.

const ALLOWED_HOSTS = new Set(['justjoin.it']);
const API_BASE = 'https://justjoin.it/api/candidate-api/offers';
const JOB_BASE = 'https://justjoin.it/job-offer/';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function assertJustJoinUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`justjoin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`justjoin: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`justjoin: untrusted hostname "${parsed.hostname}" — must be justjoin.it`);
  }
  if (!parsed.pathname.startsWith('/job-offers') && parsed.pathname !== '/api/candidate-api/offers') {
    throw new Error(`justjoin: URL path must be /job-offers or /api/candidate-api/offers: ${url}`);
  }
  return parsed;
}

function detectUrl(entry) {
  const url = entry.api || entry.careers_url || '';
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = assertJustJoinUrl(url);
    return { url: parsed.href };
  } catch {
    return null;
  }
}

function normalizeLocation(offer) {
  const parts = [];
  const workplace = String(offer?.workplaceType || '').trim();
  if (workplace) parts.push(workplace);
  if (Array.isArray(offer?.locations)) {
    for (const location of offer.locations) {
      const city = String(location?.city || '').trim();
      if (city) parts.push(city);
    }
  }
  const city = String(offer?.city || '').trim();
  if (city) parts.push(city);
  return [...new Set(parts.filter(Boolean))].join(', ');
}

function postedAtMillis(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : undefined;
}

function buildApiUrl(entry, from) {
  const apiUrl = entry.api || API_BASE;
  const parsed = assertJustJoinUrl(apiUrl);
  if (parsed.pathname !== '/api/candidate-api/offers') {
    parsed.pathname = '/api/candidate-api/offers';
    parsed.search = '';
  }
  parsed.searchParams.set('from', String(from));
  parsed.searchParams.set('itemsCount', String(Number(entry.page_size || PAGE_SIZE)));
  parsed.searchParams.set('cityRadius', String(Number(entry.city_radius || 30)));
  parsed.searchParams.set('currency', String(entry.currency || 'pln').toLowerCase());
  parsed.searchParams.set('orderBy', 'descending');
  parsed.searchParams.set('sortBy', 'publishedAt');
  parsed.searchParams.set('keywordType', 'any');
  parsed.searchParams.set('isPromoted', 'true');
  return parsed.href;
}

/**
 * Read the optional offer filters from a portals.yml entry.
 * @param {any} entry
 * @returns {{workplace: Set<string>|null, openToUkrainians: boolean, maxPolishLevel: number}}
 */
const CEFR = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

/** @param {any} offer */
function requiredPolishLevel(offer) {
  const langs = Array.isArray(offer?.languages) ? offer.languages : [];
  let highest = -1;
  for (const lang of langs) {
    const code = String(lang?.code || '').trim().toLowerCase();
    if (code !== 'pl' && code !== 'polish') continue;
    // An unrecognised level on a Polish entry counts as the top level, so it is
    // dropped rather than slipping through a strict limit.
    const idx = CEFR.indexOf(String(lang?.level || '').trim().toLowerCase());
    highest = Math.max(highest, idx === -1 ? CEFR.length - 1 : idx);
  }
  return highest;
}

export function offerFilters(entry) {
  const raw = entry?.workplace;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map(v => String(v).trim().toLowerCase())
    .filter(Boolean);
  return {
    workplace: list.length ? new Set(list) : null,
    openToUkrainians: entry?.open_to_ukrainians === true,
    // CEFR index of the highest Polish level allowed; Infinity disables the filter.
    maxPolishLevel: CEFR.includes(String(entry?.max_polish_level || '').trim().toLowerCase())
      ? CEFR.indexOf(String(entry.max_polish_level).trim().toLowerCase())
      : Infinity,
  };
}

/**
 * @param {any} json
 * @param {{workplace: Set<string>|null, openToUkrainians: boolean, maxPolishLevel: number}} [filters]
 */
export function parseJustJoinResponse(json, filters = { workplace: null, openToUkrainians: false, maxPolishLevel: Infinity }) {
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`justjoin: unexpected API response — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }
  return json.data
    .filter(offer => offer && typeof offer === 'object')
    .filter(offer => {
      if (filters.workplace && !filters.workplace.has(String(offer.workplaceType || '').toLowerCase())) return false;
      if (filters.openToUkrainians && offer.isOpenToHireUkrainians !== true) return false;
      return requiredPolishLevel(offer) <= filters.maxPolishLevel;
    })
    .map(offer => {
      const slug = String(offer.slug || '').trim();
      const title = String(offer.title || '').trim();
      if (!slug || !title) return null;
      return {
        title,
        url: `${JOB_BASE}${slug}`,
        company: String(offer.companyName || '').trim(),
        location: normalizeLocation(offer),
        // `publishedAt` moves forward every time the employer refreshes the
        // offer (most of the board carries today's date), while
        // `lastPublishedAt` keeps the earlier publication date. Prefer it so
        // max_posting_age_days sees a refreshed old posting as old.
        postedAt: postedAtMillis(offer.lastPublishedAt) ?? postedAtMillis(offer.publishedAt),
      };
    })
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'justjoin',

  detect(entry) {
    return detectUrl(entry);
  },

  async fetch(entry, ctx) {
    if (!detectUrl(entry)) throw new Error('justjoin: careers_url or api must be a trusted justjoin.it URL');

    const filters = offerFilters(entry);
    const jobs = [];
    let from = 0;
    const maxPages = Number(entry.max_pages || MAX_PAGES);
    for (let page = 0; page < maxPages; page++) {
      const url = buildApiUrl(entry, from);
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const parsed = parseJustJoinResponse(json, filters);
      jobs.push(...parsed);

      const next = json?.meta?.next?.cursor;
      // Stop on an empty raw page, not an empty filtered one: a page can be
      // filtered down to nothing while later pages still hold matches.
      if (next == null || !json.data.length) break;
      from = Number(next);
      if (!Number.isFinite(from)) break;
    }
    return jobs;
  },
};
