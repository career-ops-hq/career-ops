// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry } from './_http.mjs';

// Red Rover K12 provider — school districts at
// `https://jobs.redroverk12.com/org/<orgId>`. tracked_companies: (one entry =
// one district). Auto-detects from that careers_url.
//
// The board is a Next.js app over a public, unauthenticated GraphQL API
// (api.redroverk12.com/graphql). The query below is the one the browse page
// itself sends, trimmed to the fields used here. The API host is a fixed
// literal and the org id is digits-only, so nothing config-derived reaches the
// request URL.
//
// Only PUBLIC postings are returned. Red Rover also lists internal-only
// postings ("Internal applicants only") with no public activation date; an
// outside applicant cannot apply to those, so they are left out.
//
// The API answers up to 500 postings per call (`hasMoreData` says when there
// are more). No page cursor was found, so a board past 500 fails loudly instead
// of returning a silently truncated list.

const API_URL = 'https://api.redroverk12.com/graphql';
const REDROVER_HOST = 'jobs.redroverk12.com';

const QUERY = `query GetJobPostings($search: JobPostingSearchInput!) {
  jobSeekerSiteUnauthenticated {
    jobPostingSearch(search: $search) {
      results {
        id
        name
        organizationName
        location { name }
        activePublicOnDateUtc
        closedOnDateUtc
        allowsRemote
      }
      hasMoreData
    }
  }
}`;

/**
 * `{ origin, orgId }` from a careers_url, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, orgId: string} | null}
 */
function resolveTarget(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== REDROVER_HOST) return null;
  const orgId = (parsed.pathname.match(/^\/org\/(\d+)(?:\/|$)/) || [])[1];
  return orgId ? { origin: `https://${REDROVER_HOST}`, orgId } : null;
}

/** @type {Provider} */
export default {
  id: 'redrover',

  detect(entry) {
    const t = resolveTarget(entry);
    return t ? { url: `${t.origin}/org/${t.orgId}` } : null;
  },

  async fetch(entry, ctx) {
    const t = resolveTarget(entry);
    if (!t) throw new Error(`redrover: cannot derive org id for ${entry.name} (need an https://jobs.redroverk12.com/org/<id> careers_url)`);
    const json = await fetchJsonWithRetry(ctx, API_URL, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: t.origin },
      body: JSON.stringify({
        operationName: 'GetJobPostings',
        variables: { search: { orgId: t.orgId, searchTerm: '', locationIds: [], jobPostingCategoryIds: [] } },
        query: QUERY,
      }),
    });
    return parseRedRoverResponse(json, entry.name, t.origin, t.orgId);
  },
};

/** NaN-safe. @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the GetJobPostings GraphQL response. Exported for unit tests.
 *
 * - `null` / `{}` / `data: null` / no `results` → [] (alive, nothing there).
 * - A GraphQL `errors` array, or `jobSeekerSiteUnauthenticated` present without
 *   a `jobPostingSearch` object → throws.
 * - `hasMoreData: true` → throws (no way to fetch the rest; see header).
 * - Internal-only (no `activePublicOnDateUtc`), closed, id-less and name-less
 *   rows are skipped.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin
 * @param {string} orgId
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseRedRoverResponse(json, companyName, origin, orgId) {
  if (json == null || typeof json !== 'object') return [];
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new Error(`redrover: API error: ${json.errors[0]?.message || 'unknown GraphQL error'}`);
  }
  const site = json.data?.jobSeekerSiteUnauthenticated;
  if (site == null) return [];
  const search = site.jobPostingSearch;
  if (search == null || typeof search !== 'object') {
    throw new Error(`redrover: unexpected response shape (jobSeekerSiteUnauthenticated keys: ${Object.keys(site).join(', ') || 'none'})`);
  }
  if (search.hasMoreData) throw new Error('redrover: more postings than one response holds; paging is not supported');
  const rows = search.results;
  if (!Array.isArray(rows)) return [];

  const jobs = [];
  for (const j of rows) {
    const id = String(j?.id ?? '').trim();
    const title = String(j?.name ?? '').trim();
    // id is numeric; anything else cannot become a posting URL.
    if (!/^\d+$/.test(id) || !title) continue;
    if (!j.activePublicOnDateUtc || j.closedOnDateUtc) continue; // internal-only or closed
    const where = [j.location?.name, j.organizationName].filter(Boolean).join(' - ');
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      url: `${origin}/org/${orgId}/opening/${id}`,
      company: companyName,
      location: j.allowsRemote ? `${where} (Remote)` : where,
    };
    const postedAt = toEpochMs(j.activePublicOnDateUtc);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}
