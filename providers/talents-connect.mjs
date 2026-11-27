// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { employmentTypeField } from './_employment-type.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText, DESCRIPTION_CAP } from './_html-to-text.mjs';
import { fetchJsonWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Talents Connect JobShop career sites ("powered by Talents Connect") — one
// employer per entry, so entries go under `tracked_companies:`.
//
// Every tenant serves its job shop on its own domain (`karriere.example.de`,
// `jobs.example-career.de`), so there is no vendor host to detect: an entry
// names the provider explicitly (`provider: talents-connect`), and the
// central IP guard (`_ip-guard.mjs`) is what protects the request to that
// host. A site can run one job shop per language under a path prefix (`/`,
// `/en/`), each with its own shop id, key and posting URLs; the entry's URL
// picks the shop by its first path segment when that segment is a locale (`en`,
// `de-at`). On some sites the second shop repeats the first one's postings with
// the same requisition numbers; on others it holds translations under their own
// requisition numbers. No field names a posting's language (the shop locale is
// the page's UI language), so `language` is not set, the versions cannot be
// linked, and `ctx.dedupIncludeLanguage` / `ctx.preferredLanguageRank` change
// nothing here: a second language shop is a second entry.
//
// The shop's search page is a Nuxt app. Its `__NUXT_DATA__` payload carries the
// headers the page's own script sends to the search API, and a search key
// scoped to the shop's active postings that expires about an hour after the
// page was rendered. So fetch() reads the page on every run (nothing goes into
// `ctx.idCache`), then pages through the API on a fixed host:
//
//   GET  https://{site}{/locale}/search           (falls back to {/locale}/ on 404)
//        → __NUXT_DATA__: queryHeaders {tenantId, jobShopId, acceptLanguage},
//          and the key under `typesenseApiKey-{jobShopId}`
//   POST https://api.my-job-shop.com/api/typesense/multi_search
//        headers X-Tenant-Id, X-JobShop-Id, X-Typesense-Api-Key
//        body {"searches":[{"collection":"offers","q":"*","per_page":250,"page":N,
//              "include_fields":"…"}]}
//        → {results: [{found, hits: [{document}]}]}, or {results: [{code, error}]}
//
// The request names the fields it reads (`include_fields`): a document also
// carries contact persons, with names, e-mail addresses and phone numbers,
// which a scan has no use for.
//
// Fields. `url` is the posting link the site itself uses, on the site's own
// host: `/jobs/{slug}/{id}`, or `/offer-redirect/?offerApiId=…`, which the site
// answers with a 301 to the posting page. Its id is not `offer_uuid` on every
// tenant, so the link is taken as given, never rebuilt; a row whose `url` is
// not https on the site's host is dropped. `location[]` and `country[]` are
// parallel lists (city, country name). `external_id` is the employer's
// requisition number (`R4001`, also in the employer's Workday link);
// `create_date_timestamp` (seconds) is the posting's creation date;
// `schema_values.working_time_types` holds schema.org employment types. The
// text sections (`introduction`, `description`, `expectation`, `offering`,
// `benefits`, `additional`, `about`) make the description.
// `work_mode` and `schema_values.location_types` were empty on every tenant
// read, so no remote marker is derived from them.
//
// Pagination: PAGE_SIZE (Typesense's own maximum) rows per request,
// DEFAULT_MAX_PAGES unless the entry sets max_pages (capped at MAX_PAGES_CAP),
// and ctx.maxPages for a probe. A short page, or reaching `found`, ends the
// walk. A walk stopped by the page cap or by a failed page marks the returned
// array (`jobs.truncated`).

const API_URL = 'https://api.my-job-shop.com/api/typesense/multi_search';
const PAGE_SIZE = 250;
const DEFAULT_MAX_PAGES = 20; // 5000 postings; the largest tenant read had 349
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 250;
const LOCALE_SEGMENT_RE = /^[a-z]{2}(?:-[a-z]{2,4})?$/i;
const TENANT_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9+/]{40,4096}={0,2}$/;
const ACCEPT_LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const TEXT_FIELDS = ['introduction', 'description', 'expectation', 'offering', 'benefits', 'additional', 'about'];
const INCLUDE_FIELDS = [
  'title', 'url', 'offer_uuid', 'location', 'country', 'external_id',
  'create_date_timestamp', 'schema_values', ...TEXT_FIELDS,
].join(',');

/**
 * The shop for an entry: the site origin, rebuilt from the hostname alone, and
 * the locale prefix when the URL's first path segment is a locale. The rest of
 * the path and the query are dropped.
 * @param {unknown} raw
 * @returns {{origin: string, prefix: string} | null}
 */
export function resolveShop(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname) return null;
  const first = u.pathname.split('/').filter(Boolean)[0] || '';
  const prefix = LOCALE_SEGMENT_RE.test(first) ? `/${first.toLowerCase()}` : '';
  return { origin: `https://${u.hostname.toLowerCase()}`, prefix };
}

/**
 * A value in a Nuxt (devalue) payload: an index into the payload array, which
 * may point at a `["Reactive", index]`-style wrapper.
 * @param {unknown[]} arr
 * @param {unknown} ref
 * @returns {unknown}
 */
function deref(arr, ref) {
  let value = ref;
  for (let depth = 0; depth < 4; depth++) {
    if (!Number.isInteger(value) || /** @type {number} */ (value) < 0 || /** @type {number} */ (value) >= arr.length) return undefined;
    value = arr[/** @type {number} */ (value)];
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /Reactive|Ref$/.test(value[0])) {
      value = value[1];
      continue;
    }
    return value;
  }
  return undefined;
}

/**
 * Read the API headers and the search key from a job shop page.
 * @param {string} html
 * @returns {{tenantId: string, jobShopId: string, apiKey: string, acceptLanguage?: string}}
 */
export function parseShopPage(html) {
  const text = typeof html === 'string' ? html : '';
  const m = text.match(/<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('talents-connect: no __NUXT_DATA__ payload on the page (not a JobShop page?)');
  let arr;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    throw new Error('talents-connect: __NUXT_DATA__ payload is not valid JSON');
  }
  if (!Array.isArray(arr)) throw new Error('talents-connect: __NUXT_DATA__ payload is not an array');
  const objects = arr.filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  const headers = objects.find((o) => 'tenantId' in o && 'jobShopId' in o);
  if (!headers) throw new Error('talents-connect: no tenantId / jobShopId in the page payload');
  const tenantId = deref(arr, headers.tenantId);
  const jobShopId = deref(arr, headers.jobShopId);
  if (typeof tenantId !== 'string' || !TENANT_RE.test(tenantId)) throw new Error('talents-connect: tenant id on the page has an unexpected format');
  if (typeof jobShopId !== 'string' || !UUID_RE.test(jobShopId)) throw new Error('talents-connect: job shop id on the page has an unexpected format');
  const keyName = `typesenseApiKey-${jobShopId}`;
  let apiKey;
  for (const o of objects) {
    if (!(keyName in o)) continue;
    const v = deref(arr, o[keyName]);
    if (typeof v === 'string' && KEY_RE.test(v)) {
      apiKey = v;
      break;
    }
  }
  if (!apiKey) throw new Error('talents-connect: no search key for the job shop in the page payload');
  /** @type {{tenantId: string, jobShopId: string, apiKey: string, acceptLanguage?: string}} */
  const out = { tenantId, jobShopId, apiKey };
  const lang = deref(arr, headers.acceptLanguage);
  if (typeof lang === 'string' && ACCEPT_LANGUAGE_RE.test(lang)) out.acceptLanguage = lang;
  return out;
}

/** @param {unknown} s */
function clean(s) {
  return typeof s === 'string' ? decodeEntities(s).replace(/\s+/g, ' ').trim() : '';
}

/** @param {unknown} v */
function stringList(v) {
  return Array.isArray(v) ? v.map(clean) : [];
}

/**
 * "City, Country" per place when the two lists pair up, otherwise the places
 * and then the countries.
 * @param {unknown} cities
 * @param {unknown} countries
 * @returns {{location: string, locations: string[]}}
 */
export function buildLocation(cities, countries) {
  const c = stringList(cities);
  const k = stringList(countries);
  const unique = (/** @type {string[]} */ list) => [...new Set(list.filter(Boolean))];
  const locations = unique(c);
  let parts;
  if (c.length && c.length === k.length) {
    parts = unique(c.map((city, i) => [city, k[i]].filter(Boolean).join(', ')));
  } else {
    parts = [...locations, ...unique(k)];
  }
  return { location: parts.join(' / '), locations };
}

/** @param {Record<string, any>} doc */
function descriptionOf(doc) {
  const parts = [];
  for (const field of TEXT_FIELDS) {
    const v = doc[field];
    const html = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : v;
    const body = htmlToText(html, { cap: Infinity });
    if (body) parts.push(body);
  }
  const text = parts.join(' ').slice(0, DESCRIPTION_CAP).trim();
  return text || undefined;
}

/**
 * The posting link, accepted only as https on the shop's own host.
 * @param {unknown} raw
 * @param {string} origin
 */
function postingUrl(raw, origin) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || `https://${u.hostname.toLowerCase()}` !== origin || u.port) return null;
  u.hash = '';
  return u.href;
}

/** @param {unknown} v */
function isIdentityPart(v) {
  return typeof v === 'string' && v !== '' && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
}

/**
 * Normalize one page of the multi_search response.
 * @param {any} json
 * @param {{origin: string, company: string, tenantId: string, jobShopId: string}} opts
 * @returns {{jobs: import('./_types.js').Job[], rawCount: number, total: number | undefined}}
 */
export function parseSearchResponse(json, { origin, company, tenantId, jobShopId }) {
  const result = json && typeof json === 'object' && Array.isArray(json.results) ? json.results[0] : undefined;
  if (result && typeof result === 'object' && typeof result.error === 'string') {
    const e = /** @type {any} */ (new Error(`talents-connect: search refused (${result.code ?? 'no code'}): ${result.error}`));
    if (Number.isInteger(result.code)) e.status = result.code;
    throw e;
  }
  const rows = result && typeof result === 'object' && Array.isArray(result.hits) ? result.hits : null;
  if (!rows) {
    const got = json && typeof json === 'object'
      ? (result && typeof result === 'object' ? `results[0]: ${Object.keys(result).join(', ')}` : Object.keys(json).join(', '))
      : typeof json;
    throw new Error(`talents-connect: unexpected response — expected results[0].hits[], got: [${got}]`);
  }
  const total = Number.isInteger(result.found) && result.found >= 0 ? result.found : undefined;
  const board = `${tenantId}/${jobShopId}`;
  const jobs = [];
  for (const hit of rows) {
    const doc = hit && typeof hit === 'object' ? hit.document : null;
    if (!doc || typeof doc !== 'object') continue;
    const title = clean(doc.title);
    const url = postingUrl(doc.url, origin);
    if (!title || !url) continue;
    const { location, locations } = buildLocation(doc.location, doc.country);
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company, location };
    if (locations.length) job.locations = locations;
    const ts = doc.create_date_timestamp;
    if (Number.isFinite(ts) && ts > 0) job.postedAt = ts * 1000;
    const req = coerceId(doc.external_id);
    if (req) job.requisitionId = req;
    Object.assign(job, employmentTypeField(doc.schema_values?.working_time_types));
    const description = descriptionOf(doc);
    if (description) job.description = description;
    if (isIdentityPart(doc.offer_uuid)) {
      job.listingIdentity = { ats_provider: 'talents-connect', board_slug: board, posting_id: doc.offer_uuid };
    }
    jobs.push(job);
  }
  return { jobs, rawCount: rows.length, total };
}

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * The shop's search page, or its home page when the shop has no /search.
 * @param {any} ctx
 * @param {{origin: string, prefix: string}} shop
 */
async function fetchShopPage(ctx, shop) {
  const opts = { redirect: 'error', headers: { accept: 'text/html' } };
  try {
    return await fetchTextWithRetry(ctx, `${shop.origin}${shop.prefix}/search`, opts);
  } catch (err) {
    if (/** @type {any} */ (err)?.status !== 404) throw err;
  }
  return fetchTextWithRetry(ctx, `${shop.origin}${shop.prefix}/`, opts);
}

/** @type {Provider} */
export default {
  id: 'talents-connect',

  async fetch(entry, ctx) {
    const raw = [entry?.api, entry?.careers_url].find((v) => resolveShop(v));
    const shop = raw ? resolveShop(raw) : null;
    if (!shop) throw new Error(`talents-connect: no https job shop URL for ${entry?.name}`);

    const { tenantId, jobShopId, apiKey, acceptLanguage } = parseShopPage(await fetchShopPage(ctx, shop));
    /** @type {Record<string, string>} */
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-jobshop-id': jobShopId,
      'x-typesense-api-key': apiKey,
    };
    if (acceptLanguage) headers['accept-language'] = acceptLanguage;

    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const maxPages = Math.min(resolveMaxPages(entry), probing ? ctxMaxPages : Infinity);
    const parseOpts = { origin: shop.origin, company: entry.name, tenantId, jobShopId };

    const jobs = [];
    const seen = new Set();
    /** @type {'complete'|'cap'|'fetch-error'} */
    let stopReason = 'complete';
    let lastRaw = 0;
    let total;
    let page = 0;
    for (; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = JSON.stringify({
        searches: [{ collection: 'offers', q: '*', per_page: PAGE_SIZE, page: page + 1, include_fields: INCLUDE_FIELDS }],
      });
      let parsed;
      try {
        const json = await fetchJsonWithRetry(ctx, API_URL, { method: 'POST', body, redirect: 'error', headers });
        parsed = parseSearchResponse(json, parseOpts);
      } catch (err) {
        if (probing || page === 0) throw err;
        console.warn(`talents-connect: page ${page + 1} failed for ${entry.name} — keeping ${jobs.length} postings from earlier pages (${/** @type {any} */ (err)?.message})`);
        stopReason = 'fetch-error';
        break;
      }
      // The latest `found` decides the stop: postings added during the walk are still read.
      if (parsed.total !== undefined) total = parsed.total;
      lastRaw = parsed.rawCount;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (parsed.rawCount < PAGE_SIZE) break;
      if (total !== undefined && (page + 1) * PAGE_SIZE >= total) break;
    }
    if (stopReason === 'complete' && page >= maxPages && lastRaw >= PAGE_SIZE && (total === undefined || maxPages * PAGE_SIZE < total)) {
      stopReason = 'cap';
    }
    if (stopReason === 'cap' && !probing) {
      console.warn(`talents-connect: stopped at ${maxPages} pages for ${entry.name}${total !== undefined ? ` (${total} postings listed)` : ''} — raise max_pages on this entry`);
    }
    // A partly read board says so in the return value, so scan.mjs logs it
    // `partial` instead of `reachable` (lib/board-truncation.mjs).
    if (!probing && stopReason !== 'complete') {
      markTruncated(jobs, stopReason === 'cap' ? 'page-cap' : 'fetch-error', { fetched: jobs.length, ...(total !== undefined ? { total } : {}) });
    }
    return jobs;
  },
};
