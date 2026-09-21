// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Rippling provider — hits the tenant's public v2 board JSON API.
// Auto-detects from a careers_url like `https://ats.rippling.com/<slug>/jobs`
// (the `<slug>` is the first path segment).
//
// Board API (same origin as the careers pages — no separate API host):
//   GET https://ats.rippling.com/api/v2/board/<slug>/jobs?page=<n>&pageSize=<n>
// Response: `{ items: [...], page, pageSize, totalItems, totalPages }`, each
// item `{ id, name, url, department: { name }, locations: [{ name, ... }], language }`.
//
// The client itself caps pageSize at 1000; requesting that size returns a
// tenant's whole board in one request for any realistically-sized company —
// Rippling's own board, the largest tenant seen, runs 606 postings, still
// one page under that cap. Still paginated below with its own page-count
// ceiling — never trusting the source's own `totalPages` alone — for the
// rare tenant whose board exceeds one page.

import { fetchJsonWithRetry, sleep } from './_http.mjs';

const CAREERS_HOST = 'ats.rippling.com';
const API_BASE = `https://${CAREERS_HOST}/api/v2/board`;
const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

// Largest pageSize the client itself ever requests (see header comment).
const PAGE_SIZE = 1000;

// Page count ceiling, independent of what `totalPages` reports — a growing
// or tampered response must not turn one portals.yml line into an unbounded
// request loop. DEFAULT_MAX_PAGES * PAGE_SIZE = 10,000 postings is already
// implausible for one company; MAX_PAGES_CAP leaves headroom for an explicit
// override without going unbounded.
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_CAP = 50;

// Delay between successive pages of one tenant's own pagination loop — the
// common single-page board never pays it.
const INTER_PAGE_DELAY_MS = 200;

const RETRY_POLICY = { retries: 2 };

// Why the walk over one tenant's pages stopped.
const STOP_REASON = {
  COMPLETE: 'complete',
  CAP: 'cap',
  FETCH_ERROR: 'fetch-error',
};

/**
 * Resolve the tenant slug (e.g. `just-appraised-jobs`) from a careers_url.
 * Returns null for non-Rippling, malformed, or unsafe-slug URLs.
 * @param {import('./_types.js').PortalEntry} entry
 */
function resolveSlug(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== CAREERS_HOST) return null;
  const segment = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (!SLUG_RE.test(segment)) return null;
  return segment;
}

/** Build one page's board API URL for a validated slug. */
function apiUrlForSlug(slug, page) {
  // slug is config-derived (portals.yml careers_url), already restricted to
  // SLUG_RE's charset — plain encodeURIComponent here is defense-in-depth,
  // not a host-controlled response field that would need a surrogate-safe
  // encoder with a drop-the-posting fallback.
  const encodedSlug = encodeURIComponent(slug);
  const apiUrl = new URL(`${API_BASE}/${encodedSlug}/jobs`);
  apiUrl.searchParams.set('page', String(page));
  apiUrl.searchParams.set('pageSize', String(PAGE_SIZE));
  return apiUrl.href;
}

/** @param {string} url */
function assertRipplingApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`rippling: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`rippling: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== CAREERS_HOST) {
    throw new Error(`rippling: untrusted hostname "${parsed.hostname}" — must be ${CAREERS_HOST}`);
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
 * Parse one page of the Rippling v2 board API response. Exported for unit
 * tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `name`, trimmed (postings without one are dropped).
 *   - url:      `url` — an absolute `https:` posting URL host-locked to
 *               `ats.rippling.com` (Rippling always serves postings there, so
 *               an off-host or non-https URL is untrusted and the posting is
 *               dropped). It is the dedup key and is display-only (written to
 *               the pipeline/history, never server-fetched here).
 *   - company:  the portal entry name (the feed is per-tenant and carries no
 *               company field, same as recruitee).
 *   - location: every `locations[].name`, joined with ` · ` (a posting can
 *               list more than one place); "" when the array is empty/absent.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {{jobs: Array<{title: string, url: string, company: string, location: string}>, rawCount: number}}
 */
export function parseRipplingPage(json, companyName) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`rippling: unexpected response — expected items[], got: [${got}]`);
  }
  const rawCount = json.items.length;
  const jobs = json.items
    .map((j) => {
      const title = typeof j?.name === 'string' ? j.name.trim() : '';
      if (!title) return null;

      // url must be an absolute https posting link on ats.rippling.com — Rippling
      // always serves postings there (no custom-domain case), so an off-host URL
      // is untrusted and dropped. url is the dedup key.
      let url = '';
      const rawUrl = typeof j?.url === 'string' ? j.url.trim() : '';
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol === 'https:' && parsed.hostname === CAREERS_HOST) url = parsed.href;
        } catch {
          // malformed URL → leave url = '' → dropped below
        }
      }
      if (!url) return null;

      const locs = Array.isArray(j?.locations) ? j.locations : [];
      const location = locs
        .map((l) => (l && typeof l.name === 'string' ? l.name.trim() : ''))
        .filter(Boolean)
        .join(' · ');

      return { title, url, location, company: companyName };
    })
    .filter(Boolean);
  return { jobs, rawCount };
}

/** @type {Provider} */
export default {
  id: 'rippling',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: apiUrlForSlug(slug, 0) } : null;
  },

  /**
   * @param {{ name?: string, careers_url?: string, max_pages?: number }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   */
  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`rippling: cannot derive API URL for ${entry.name}`);

    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);
    // Health probe (verify-portals) sets ctx.maxPages: 1 — don't wrap or
    // swallow its ProbePageBudgetReached rejection, propagate it unwrapped.
    const probing = ctxCap !== Infinity;

    const jobs = [];
    let stopReason = STOP_REASON.COMPLETE;
    let page = 0;
    for (; page < pagesToFetch; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = apiUrlForSlug(slug, page);
      assertRipplingApiUrl(url);

      let json;
      try {
        json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' }, RETRY_POLICY);
      } catch (err) {
        if (probing) throw err;
        const attempts = err?.attempts ?? RETRY_POLICY.retries + 1;
        console.error(`⚠️  rippling: ${entry.name} truncated at page ${page + 1} of ${pagesToFetch} after ${attempts} attempts (${jobs.length} jobs): ${err.message}`);
        stopReason = STOP_REASON.FETCH_ERROR;
        break;
      }

      const { jobs: pageJobs, rawCount } = parseRipplingPage(json, entry.name);
      jobs.push(...pageJobs);

      // Natural end: the source's own raw row count for this page (before
      // malformed-row filtering) is short of PAGE_SIZE. Break WITHOUT
      // incrementing page — a short page that happens to land on the last
      // allowed page must still read as a natural end below, not as the
      // ceiling having truncated a healthy board.
      if (rawCount < PAGE_SIZE) break;
    }

    // Only a healthy walk that ran out of its OWN entry.max_pages /
    // DEFAULT_MAX_PAGES budget counts as capped — never a probe's ctx.maxPages
    // cap and never a fetch-error stop: this warning means the ceiling
    // truncated a healthy board, not that the board broke.
    if (stopReason === STOP_REASON.COMPLETE && page === pagesToFetch && pagesToFetch === maxPages) {
      stopReason = STOP_REASON.CAP;
      console.error(`⚠️  rippling: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};
