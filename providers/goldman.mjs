// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Goldman Sachs provider. Goldman's careers site (higher.gs.com) is a Next.js
// app whose role search calls a public, logged-out GraphQL endpoint:
//   POST https://api-higher.gs.com/gateway/api/v1/graphql   (query GetRoles)
// the same query the site's own /results page sends. No key, cookie or
// session; measured 2026-11-18: totalCount 744 for PROFESSIONAL + EARLY_CAREER
// and 192 for CAMPUS. Each role's posting page is
//   https://higher.gs.com/roles/{externalSource.sourceId}
//
// `experiences` is required by the API and must not be empty. The enum also
// has INTERNAL_MOBILITY, which lists roles open to current employees only, so
// the default reads the three public experiences. An entry can narrow it:
//   - name: Goldman Sachs
//     careers_url: https://higher.gs.com/results
//     goldman:
//       experiences: [PROFESSIONAL, EARLY_CAREER]   # optional
//     max_pages: 20                                # optional, 100 roles each
//
// The payload carries no posting date, so rows have no postedAt (an absent
// date reads as unknown, never stale).

const ENDPOINT = 'https://api-higher.gs.com/gateway/api/v1/graphql';
const ENDPOINT_HOST = 'api-higher.gs.com';
const SITE_HOST = 'higher.gs.com';
const ROLE_BASE = 'https://higher.gs.com/roles/';
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20; // 2,000 roles: ~2x the whole public board (936 on 2026-11-18)
const MAX_PAGES_CAP = 100; // hard ceiling even for a max_pages override
const INTER_PAGE_DELAY_MS = 300;
const RETRY_POLICY = { retries: 3 };
export const PUBLIC_EXPERIENCES = ['PROFESSIONAL', 'EARLY_CAREER', 'CAMPUS'];

const QUERY = `query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items { roleId jobTitle locations { primary city state country } externalSource { sourceId } }
  }
}`;

/** @param {any} entry */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  return Number.isInteger(v) && v > 0 ? Math.min(v, MAX_PAGES_CAP) : DEFAULT_MAX_PAGES;
}

/**
 * The experiences to request: the entry's `goldman.experiences` when it lists
 * only known public values, else all public ones. A typo throws, since a
 * silently dropped value would read as a smaller board.
 * @param {any} entry
 */
export function resolveExperiences(entry) {
  const raw = entry?.goldman?.experiences;
  if (raw === undefined || raw === null) return [...PUBLIC_EXPERIENCES];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('goldman: goldman.experiences must be a non-empty list');
  }
  const out = [];
  for (const v of raw) {
    const up = String(v).trim().toUpperCase();
    if (!PUBLIC_EXPERIENCES.includes(up)) {
      throw new Error(`goldman: unknown experience "${v}" (use ${PUBLIC_EXPERIENCES.join(', ')})`);
    }
    if (!out.includes(up)) out.push(up);
  }
  return out;
}

/** @param {any} loc */
function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  return [loc.city, loc.state, loc.country]
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim())
    .join(', ');
}

/**
 * The posting id as a listingIdentity part, or null when it is unusable there:
 * missing, empty, padded or carrying a control character. Never trimmed, so a
 * padded id falls back to URL dedup instead of becoming a different key.
 * @param {unknown} raw
 * @returns {string|null}
 */
function identityId(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
  if (typeof raw !== 'string' || raw === '' || raw !== raw.trim()) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  return raw;
}

/**
 * Map one roleSearch item to a Job, or null when it lacks a title or an id
 * that forms a role URL. Exported for tests.
 * @param {any} it
 * @param {string} company
 * @returns {Job|null}
 */
export function toJob(it, company) {
  if (!it || typeof it !== 'object') return null;
  const title = typeof it.jobTitle === 'string' ? it.jobTitle.trim() : '';
  const rawId = it.externalSource?.sourceId;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  if (!title || !id) return null;
  const encoded = safeEncodeURIComponent(id);
  // `.` and `..` survive encoding unchanged and resolve /roles/.. to the
  // careers home page, not a posting.
  if (encoded === null || encoded === '.' || encoded === '..') return null;
  const locs = Array.isArray(it.locations) ? it.locations.filter((l) => l && typeof l === 'object') : [];
  const ordered = [...locs.filter((l) => l.primary), ...locs.filter((l) => !l.primary)];
  const locations = [...new Set(ordered.map(formatLocation).filter(Boolean))];
  const postingId = identityId(rawId);
  return {
    title,
    url: `${ROLE_BASE}${encoded}`,
    company,
    location: locations.join('; '),
    ...(locations.length > 0 ? { locations } : {}),
    externalId: id,
    ...(postingId === null ? {} : {
      listingIdentity: { ats_provider: 'goldman', board_slug: SITE_HOST, posting_id: postingId },
    }),
  };
}

/**
 * Read one page's roleSearch envelope, throwing on anything that is not it.
 * @param {any} res
 */
function roleSearchOf(res) {
  if (!res || typeof res !== 'object') {
    throw new Error(`goldman: GraphQL response is not an object (got ${typeof res})`);
  }
  if (Array.isArray(res.errors) && res.errors.length > 0) {
    throw new Error(`goldman: GraphQL error: ${String(res.errors[0]?.message || 'unknown')}`);
  }
  const rs = res.data?.roleSearch;
  if (!rs || typeof rs !== 'object' || !Array.isArray(rs.items)) {
    const keys = res.data && typeof res.data === 'object' ? Object.keys(res.data).join(', ') : typeof res.data;
    throw new Error(`goldman: response has no data.roleSearch.items list (data keys: ${keys || 'none'})`);
  }
  return rs;
}

/** @type {Provider} */
export default {
  id: 'goldman',

  detect(entry) {
    if (entry?.provider === 'goldman') return { url: ENDPOINT };
    const raw = entry?.careers_url;
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && u.hostname.toLowerCase() === SITE_HOST) return { url: ENDPOINT };
    } catch {
      // not a URL
    }
    return null;
  },

  async fetch(entry, ctx) {
    const endpoint = new URL(ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== ENDPOINT_HOST) {
      throw new Error(`goldman: untrusted endpoint ${ENDPOINT}`);
    }
    const experiences = resolveExperiences(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const entryCap = resolveMaxPages(entry);
    const maxPages = probing ? Math.min(entryCap, ctxMaxPages) : entryCap;

    /** @type {Map<string, Job>} */
    const out = new Map();
    let total = null;
    let ended = false; // set only by a natural end of the board
    /** @type {Set<string>} */
    const seenPages = new Set();
    /** @type {Set<string>} */
    const seenRawIds = new Set();
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = JSON.stringify({
        operationName: 'GetRoles',
        query: QUERY,
        variables: {
          searchQueryInput: {
            page: { pageSize: PAGE_SIZE, pageNumber: page },
            sort: { sortStrategy: 'RELEVANCE', sortOrder: 'DESC' },
            filters: [],
            experiences,
            searchTerm: '',
          },
        },
      });
      const res = await fetchJsonWithRetry(ctx, ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        body,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      }, RETRY_POLICY);
      const rs = roleSearchOf(res);
      if (total === null && Number.isInteger(rs.totalCount)) total = rs.totalCount;
      for (const it of rs.items) {
        const job = toJob(it, entry.name);
        if (job && !out.has(job.url)) out.set(job.url, job);
      }
      // Only the board itself ends the walk: an empty page, a short page, or a
      // repeated page (the API ignoring pageNumber). totalCount is never proof
      // the walk is complete. A repeat is judged on the raw page, not on what
      // survived toJob(): a full page of malformed rows is still a distinct
      // page, and the next one can hold valid roles.
      if (rs.items.length === 0 || rs.items.length < PAGE_SIZE) { ended = true; break; }
      const pageSig = JSON.stringify(rs.items);
      const rawIds = rs.items.map((it) => it?.externalSource?.sourceId)
        .filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
      const repeated = seenPages.has(pageSig)
        || (rawIds.length > 0 && rawIds.every((v) => seenRawIds.has(v)));
      if (repeated) { ended = true; break; }
      seenPages.add(pageSig);
      for (const v of rawIds) seenRawIds.add(v);
    }
    const jobs = [...out.values()];
    if (!ended && !probing) {
      const counts = total === null ? `${jobs.length} roles, total unknown` : `${jobs.length} of ${total} roles`;
      console.error(`⚠️  goldman: ${entry.name} stopped at max_pages=${maxPages} (${counts}) — raise max_pages on this entry for more (up to ${MAX_PAGES_CAP})`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length, ...(total === null ? {} : { total }) });
    }
    return jobs;
  },
};
