// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Gem provider — hits the public GraphQL batch endpoint behind
// jobs.gem.com/<boardId> SPA boards.
//
// Verified live via bare POSTs with no auth headers and no cookies — the
// endpoint is unauthenticated for public boards. Two queries:
//   - JobBoardList(boardId): the listing — title, locations, department,
//     employment/location type, but NO date field.
//   - ExternalJobPostingQuery(boardId, extId): per-job detail, carries
//     firstPublishedTsSec (the postedAt source), plus descriptionHtml,
//     jobPostSectionHtml, and compensationHtml for the job description.
//     Since the endpoint is literally a *batch* endpoint, every job's
//     detail query is folded into ONE extra POST (one operation per extId)
//     rather than N round-trips.
// The `{boardId}/{extId}` URL pattern is confirmed against a real captured
// browser session (page referer for a real job matched this exact shape),
// not just inferred from field naming.

import { decodeEntities } from './_html-entities.mjs';

const GEM_API_URL = 'https://jobs.gem.com/api/public/graphql/batch';
const ALLOWED_GEM_HOSTS = new Set(['jobs.gem.com']);

const JOB_BOARD_LIST_QUERY = `query JobBoardList($boardId: String!) {
  oatsExternalJobPostings(boardId: $boardId) {
    jobPostings {
      id
      extId
      title
      locations {
        id
        name
        city
        isoCountry
        isRemote
        extId
        __typename
      }
      job {
        id
        department {
          id
          name
          extId
          __typename
        }
        locationType
        employmentType
        __typename
      }
      __typename
    }
    __typename
  }
}
`;

const JOB_DETAIL_QUERY = `query ExternalJobPostingQuery($boardId: String!, $extId: String!) {
  oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
    extId
    firstPublishedTsSec
    descriptionHtml
    jobPostSectionHtml {
      introHtml
      outroHtml
    }
    compensationHtml
    __typename
  }
}
`;

// NaN-safe — firstPublishedTsSec is unix SECONDS, unlike most providers' ms epochs.
function toEpochMsFromSeconds(value) {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

// Same tag-strip + entity-decode convention as the other scraping providers
// (deutschebahn.mjs, hecklerkoch.mjs, etc.) that get raw HTML back.
function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Concatenate intro + body + outro in page order, then append compensationHtml
// as a labeled trailing section (it's a distinct field, not prose that flows
// from the outro). Any absent field is dropped rather than leaving a gap, so
// a posting with only descriptionHtml (the common case) renders identically
// to before this field list was widened.
/** @param {any} posting */
function buildJobDescriptionText(posting) {
  const intro = htmlToText(posting?.jobPostSectionHtml?.introHtml);
  const body = htmlToText(posting?.descriptionHtml);
  const outro = htmlToText(posting?.jobPostSectionHtml?.outroHtml);
  const compensation = htmlToText(posting?.compensationHtml);

  const text = [intro, body, outro].filter(Boolean).join('\n\n');
  return compensation ? [text, `Compensation: ${compensation}`].filter(Boolean).join('\n\n') : text;
}

/** @param {string} url */
function assertGemUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`gem: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`gem: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GEM_HOSTS.has(parsed.hostname))
    throw new Error(`gem: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GEM_HOSTS].join(', ')}`);
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveBoardId(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'jobs.gem.com') return null;
  const match = parsed.pathname.match(/^\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** @param {any} loc */
function formatLocation(loc) {
  const parts = [];
  if (typeof loc?.name === 'string' && loc.name.trim()) parts.push(loc.name.trim());
  if (loc?.isRemote) parts.push('Remote');
  return parts.join(' · ');
}

/** @type {Provider} */
export default {
  id: 'gem',

  detect(entry) {
    const boardId = resolveBoardId(entry);
    return boardId ? { url: `${GEM_API_URL}?board=${boardId}` } : null;
  },

  async fetch(entry, ctx) {
    const boardId = resolveBoardId(entry);
    if (!boardId) throw new Error(`gem: cannot derive board id for ${entry.name}`);
    assertGemUrl(GEM_API_URL);

    const body = JSON.stringify([
      { operationName: 'JobBoardList', variables: { boardId }, query: JOB_BOARD_LIST_QUERY },
    ]);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertGemUrl above it guarantees the final hostname stays in the allowlist.
    const json = /** @type {any} */ (await ctx.fetchJson(GEM_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', batch: 'true' },
      body,
      redirect: 'error',
    }));

    const listResult = json?.[0];
    if (Array.isArray(listResult?.errors) && listResult.errors.length > 0) {
      throw new Error(`gem: JobBoardList failed: ${listResult.errors[0]?.message || 'unknown GraphQL error'}`);
    }
    const postings = listResult?.data?.oatsExternalJobPostings?.jobPostings;
    if (!Array.isArray(postings)) return [];

    const validPostings = postings.filter(/** @param {any} p */ p => p.extId && p.title);

    // Enrichment, not core data — postedAt/description matter but their
    // absence shouldn't fail the whole board. One extra batched POST (one
    // ExternalJobPostingQuery op per job) rather than N round-trips.
    const postedAtByExtId = new Map();
    const descriptionByExtId = new Map();
    if (validPostings.length > 0) {
      try {
        const detailBody = JSON.stringify(
          validPostings.map(/** @param {any} p */ p => ({
            operationName: 'ExternalJobPostingQuery',
            variables: { boardId, extId: p.extId },
            query: JOB_DETAIL_QUERY,
          }))
        );
        const detailJson = /** @type {any} */ (await ctx.fetchJson(GEM_API_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', batch: 'true' },
          body: detailBody,
          redirect: 'error',
        }));
        if (Array.isArray(detailJson)) {
          for (const entry of detailJson) {
            const posting = entry?.data?.oatsExternalJobPosting;
            if (posting?.extId) {
              postedAtByExtId.set(posting.extId, toEpochMsFromSeconds(posting.firstPublishedTsSec));
              descriptionByExtId.set(posting.extId, buildJobDescriptionText(posting));
            }
          }
        }
      } catch {
        // Listing still stands without dates/description — recency filtering
        // and content_filter just won't apply to this board.
      }
    }

    return validPostings.map(/** @param {any} p */ p => ({
      title: p.title || '',
      url: `https://jobs.gem.com/${boardId}/${p.extId}`,
      company: entry.name,
      location: Array.isArray(p.locations) ? [...new Set(p.locations.map(formatLocation).filter(Boolean))].join(' · ') : '',
      description: descriptionByExtId.get(p.extId) || '',
      postedAt: postedAtByExtId.get(p.extId),
    }));
  },
};
