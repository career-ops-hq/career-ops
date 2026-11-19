// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { countryName } from './_country.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { fetchResponseWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// VeloraHR provider (tracked_companies:) — career sites hosted by Velora HR, a
// Spanish ATS, at `https://<tenant>.career.velorahr.com/<slug>-<siteId>`
// (e.g. `acme.career.velorahr.com/acme-123`). Auto-detects from that
// careers_url shape; only the vendor's own hosts are read.
//
// The site is a Next.js page that server-renders only the first 6 offers. The
// full list comes from the public JSON API the page itself calls for paging
// and filters (no key, no cookie):
//   GET https://api.velorahr.com/api/public/career-site/<siteId>/offers
//       ?range=[0,99]&sort=["created_at","DESC"]
//   -> { data: [offer, ...], success: true } and a `Content-Range: Rest 0-99/<total>`
//      header. <siteId> is the number ending the first path segment of the
//      careers URL. The list rows already carry the full description, so no
//      per-posting request is made.
//
// An unknown site id answers 200 with an empty `data` and `Content-Range: …/0`,
// the same answer as a real board with no openings. Only the careers page
// tells them apart (404 for an unknown id), so an empty list is checked
// against it once; a 404 there is a loud failure, an empty board is `[]`.
// Observed live 2026-11-18: one tenant with 7 offers and one with 4, both
// well under one page.

const TENANT_HOST_RE = /^[a-z0-9][a-z0-9-]*\.career\.velorahr\.com$/;
// `<slug>-<siteId>`: the slug is whatever the tenant chose, the id the digits
// after its last hyphen.
const SITE_SEGMENT_RE = /^[A-Za-z0-9_-]+-(\d{1,12})$/;
const API_ROOT = 'https://api.velorahr.com/api/public/career-site';
const PAGE_SIZE = 100;
const INTER_PAGE_DELAY_MS = 200;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && /** @type {number} */ (v) > 0) return Math.min(/** @type {number} */ (v), MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Tenant origin, careers-page path and site id from an entry's careers_url.
 * Only the hostname is trusted: the origin is rebuilt from it, and the path
 * contributes nothing but its first segment (`<slug>-<siteId>`).
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, slug: string, siteId: string} | null}
 */
function resolveSite(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !TENANT_HOST_RE.test(parsed.hostname)) return null;
  const slug = parsed.pathname.split('/')[1] || '';
  const m = SITE_SEGMENT_RE.exec(slug);
  if (!m) return null;
  return { origin: `https://${parsed.hostname}`, slug, siteId: m[1] };
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** `work_mode` as the API states it (Spanish). Anything else is left unset. */
const WORK_MODE = /** @type {Record<string, 'remote' | 'hybrid' | 'onsite'>} */ ({
  remoto: 'remote',
  hibrido: 'hybrid',
  presencial: 'onsite',
});

/** @param {unknown} v */
function workplaceOf(v) {
  if (typeof v !== 'string') return undefined;
  return WORK_MODE[v.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')];
}

/**
 * The API's own offer id as a canonical decimal string: a positive integer
 * (number or decimal string), nothing else.
 * @param {unknown} id
 * @returns {string | undefined}
 */
function offerId(id) {
  const s = coerceId(id);
  return s !== undefined && /^[1-9][0-9]{0,15}$/.test(s) ? s : undefined;
}

/**
 * Parse one page of the offers API. Exported for unit tests.
 *
 *   { data: [{ id, clean_title, title, city, province, country, work_mode,
 *              description_html, requirements_html, created_at, ... }] }
 *
 * - url: `<origin>/<slug>/offers/<id>`, the public offer page. Built from the
 *   payload `id`, which must be a positive integer (so it needs no escaping,
 *   as the slug, restricted by SITE_SEGMENT_RE, does not either); a row without one, or
 *   without a title, is dropped.
 * - title: `clean_title`, or `title` when `clean_title` is blank (`title` carries
 *   the tenant's internal requisition code in brackets).
 * - listingIdentity: `velorahr` / site id / payload `id`, omitted when the raw
 *   `id` is a string with surrounding whitespace (identity ids are never trimmed;
 *   the row keeps its URL and falls back to URL dedup).
 *
 * @param {any} json
 * @param {{companyName: string, origin: string, slug: string, siteId: string}} site
 * @returns {{jobs: import('./_types.js').Job[], rawCount: number}}
 */
export function parseVeloraHrPage(json, site) {
  const rows = json && Array.isArray(json.data) ? json.data : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : json === null ? 'null' : typeof json;
    throw new Error(`velorahr: unexpected response for ${site.companyName} — expected data[], got: [${got}]`);
  }
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  for (const o of rows) {
    if (!o || typeof o !== 'object') continue;
    // Each candidate is trimmed on its own, so a blank `clean_title` does not
    // shadow a usable `title`; non-string values count as absent.
    const title = [o.clean_title, o.title].map(t => (typeof t === 'string' ? t.trim() : '')).find(Boolean) || '';
    const id = offerId(o.id);
    const padded = typeof o.id === 'string' && o.id !== o.id.trim();
    if (!title || !id) continue;

    const country = typeof o.country === 'string' && o.country.trim() ? o.country.trim() : undefined;
    const province = typeof o.province === 'string' ? o.province.trim() : '';
    const city = typeof o.city === 'string' ? o.city.trim() : '';
    // `province` repeats `city` in the common case (Madrid, Madrid).
    const place = [city, province.toLowerCase() !== city.toLowerCase() ? province : '', country ? countryName(country) || country : '']
      .filter(Boolean);
    const description = htmlToText([o.description_html, o.requirements_html].filter(s => typeof s === 'string').join(' '));
    const postedAt = toEpochMs(o.created_at);
    const workplaceType = workplaceOf(o.work_mode);

    jobs.push({
      title,
      url: `${site.origin}/${site.slug}/offers/${id}`,
      company: site.companyName,
      location: place.join(', '),
      ...(country ? { country } : {}),
      ...(workplaceType ? { workplaceType } : {}),
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(description ? { description } : {}),
      ...(padded ? {} : { listingIdentity: { ats_provider: 'velorahr', board_slug: site.siteId, posting_id: id } }),
    });
  }
  return { jobs, rawCount: rows.length };
}

/** @type {Provider} */
export default {
  id: 'velorahr',

  detect(entry) {
    const site = resolveSite(entry);
    return site ? { url: `${site.origin}/${site.slug}` } : null;
  },

  async fetch(entry, ctx) {
    const site = resolveSite(entry);
    if (!site) {
      throw new Error(`velorahr: cannot derive the site from careers_url for ${entry.name} — expected https://<tenant>.career.velorahr.com/<slug>-<siteId>`);
    }
    const parseSite = { companyName: entry.name, ...site };
    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && /** @type {number} */ (ctx.maxPages) > 0 ? /** @type {number} */ (ctx.maxPages) : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    const seen = new Set();
    let offset = 0;
    let total = null;
    let hitCap = false;
    let rawTotal = 0; // rows the source returned, before normalisation
    let shortRead = false;
    for (let page = 0; ; page++) {
      if (page >= pagesToFetch) {
        hitCap = true; // reached only when the last page fetched did not end the walk
        break;
      }
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = new URL(`${API_ROOT}/${site.siteId}/offers`);
      url.searchParams.set('range', `[${offset},${offset + PAGE_SIZE - 1}]`);
      url.searchParams.set('sort', JSON.stringify(['created_at', 'DESC']));
      // A page that fails after retry fails the board: a partial list would
      // read as a complete one.
      const res = await fetchResponseWithRetry(ctx, url.href, { redirect: 'error' });
      let json;
      try {
        json = await res.json();
      } catch {
        throw new Error(`velorahr: ${entry.name} returned a body that is not JSON`);
      }
      const { jobs: pageJobs, rawCount } = parseVeloraHrPage(json, parseSite);
      // The total is this page's own: a page without a usable header must not
      // keep driving the stop from an earlier page's number.
      const reportedMatch = /\/(\d+)\s*$/.exec(res.headers?.get?.('content-range') ?? '');
      total = reportedMatch ? Number(reportedMatch[1]) : null;
      for (const job of pageJobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      offset += rawCount;
      rawTotal += rawCount;
      // The walk ends on the source's own page shape: an empty page, or the
      // reported total reached (a short page when none was reported).
      // An empty page while the reported total is not reached is an incomplete
      // read, not the end of the board.
      if (rawCount === 0 && total !== null && offset < total) shortRead = true;
      const done = rawCount === 0 || (total !== null ? offset >= total : rawCount < PAGE_SIZE);
      if (done) break;
    }

    if (hitCap && ctxCap === Infinity) {
      console.error(`⚠️  velorahr: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length}${total !== null ? ` of ${total}` : ''} offers) — raise max_pages on this entry for more`);
      markTruncated(jobs, 'page-cap', total !== null ? { fetched: jobs.length, total } : { fetched: jobs.length });
    }

    if (shortRead) {
      console.error(`⚠️  velorahr: ${entry.name} returned an empty page at offset ${offset} of ${total} reported offers — the list is incomplete`);
      markTruncated(jobs, 'short-page', { fetched: jobs.length, total: /** @type {number} */ (total) });
    }

    // Total 0 is also the answer for an unknown site id: only the careers page
    // (404 when the id is wrong) tells a real empty board from a typo.
    // Decided on the rows the source returned: rows that all failed to parse
    // are not an empty answer.
    if (rawTotal === 0) {
      await fetchTextWithRetry(ctx, `${site.origin}/${site.slug}`, { redirect: 'error' });
    }
    return jobs;
  },
};
