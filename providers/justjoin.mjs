// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JustJoin.it provider — hits the current candidate offers API.
// Browser URLs under https://justjoin.it/job-offers/... are accepted for
// detection, but fetches use https://justjoin.it/api/candidate-api/offers.

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

export function parseJustJoinResponse(json) {
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`justjoin: unexpected API response — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }
  return json.data
    .filter(offer => offer && typeof offer === 'object')
    .map(offer => {
      const slug = String(offer.slug || '').trim();
      const title = String(offer.title || '').trim();
      if (!slug || !title) return null;
      return {
        title,
        url: `${JOB_BASE}${slug}`,
        company: String(offer.companyName || '').trim(),
        location: normalizeLocation(offer),
        postedAt: postedAtMillis(offer.publishedAt),
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

    const jobs = [];
    let from = 0;
    const maxPages = Number(entry.max_pages || MAX_PAGES);
    for (let page = 0; page < maxPages; page++) {
      const url = buildApiUrl(entry, from);
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const parsed = parseJustJoinResponse(json);
      jobs.push(...parsed);

      const next = json?.meta?.next?.cursor;
      if (next == null || parsed.length === 0) break;
      from = Number(next);
      if (!Number.isFinite(from)) break;
    }
    return jobs;
  },
};
