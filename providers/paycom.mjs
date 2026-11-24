// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Paycom provider — single-company ATS adapter for `tracked_companies:`.
// Public, no-auth JSON API reached in two steps:
//   1. GET https://www.paycomonline.net/v4/ats/web.php/portal/<clientKey>/career-page
//      The HTML embeds a short-lived anonymous JWT (issued to every page load)
//      and the tenant's `atsPortalMantleServiceUrl`.
//   2. POST <serviceUrl>api/ats/job-posting-previews/search
//      headers: Authorization: <jwt>, Content-Type: application/json
//      body:    { skip, take, filtersForQuery: {…empty filters…} }
//      → { jobPostingPreviews: [{ jobId, jobTitle, locations, description,
//           postedOn, positionType, remoteType, isHotJob }], jobPostingPreviewsCount }
//
// No login is involved: the token is minted client-side for any visitor, which
// is the only reason for the two steps. Verified live 2026-11 on two tenants.
// `description` in the preview is a truncated teaser, so it is not used, and
// `postedOn` came back empty on every posting seen, so no date is read.
//
// Auto-detects from careers_url on host `www.paycomonline.net` when the path
// carries a `/portal/<clientKey>/` segment. An entry can also set
// `provider: paycom` with `client_key`.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const PAYCOM_HOST = 'www.paycomonline.net';
const PAYCOM_ORIGIN = `https://${PAYCOM_HOST}`;

// Client keys seen live are 32 hex chars. Anything else is refused rather than
// interpolated into a URL, which also keeps a lone surrogate out.
const CLIENT_KEY_RE = /^[0-9A-Fa-f]{16,64}$/;

// One search request; the API takes skip/take, and no tenant seen comes near it.
const PAGE_SIZE = 200;

const HEADERS = {
  'user-agent': BROWSER_LIKE_USER_AGENT,
  'accept-language': 'en-US,en;q=0.9',
};

/** Client key from `client_key` or the careers_url path. @returns {string|null} */
export function resolvePaycomClientKey(entry) {
  let key = typeof entry?.client_key === 'string' ? entry.client_key : '';
  if (!key) {
    const raw = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
    if (!raw) return null;
    let parsed;
    try { parsed = new URL(raw); } catch { return null; }
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== PAYCOM_HOST) return null;
    const m = parsed.pathname.match(/\/portal\/([^/]+)/);
    key = m ? m[1] : '';
  }
  return key && CLIENT_KEY_RE.test(key) ? key : null;
}

const careerPageUrl = (key) => `${PAYCOM_ORIGIN}/v4/ats/web.php/portal/${key}/career-page`;

/**
 * Pull the anonymous JWT and the mantle service URL out of the career-page HTML.
 * The values are JSON-escaped in the page (`\/`), so backslashes are stripped
 * before matching. Exported for unit tests.
 * @returns {{jwt: string, serviceUrl: string}|null}
 */
export function extractPaycomSession(html) {
  if (typeof html !== 'string' || !html) return null;
  const jwt = (html.match(/eyJ0eXAiOiJKV1Qi[A-Za-z0-9_.-]+/) || [])[0] || '';
  const noslash = html.replace(/\\/g, '');
  const svc = (noslash.match(/atsPortalMantleServiceUrl"?:?"?(https:\/\/[a-z0-9.-]+paycomonline\.net\/?)/i) || [])[1] || '';
  if (!jwt || !svc) return null;
  const serviceUrl = svc.endsWith('/') ? svc : `${svc}/`;
  return { jwt, serviceUrl };
}

const SEARCH_BODY = {
  skip: 0,
  take: PAGE_SIZE,
  filtersForQuery: {
    distanceFrom: 0,
    workEnvironments: [], positionTypes: [], educationLevels: [],
    categories: [], travelTypes: [], shiftTypes: [], otherFilters: [],
    keywordSearchText: '', location: '', sortOption: '',
  },
};

/** @type {Provider} */
export default {
  id: 'paycom',

  detect(entry) {
    const key = resolvePaycomClientKey(entry);
    return key ? { url: careerPageUrl(key) } : null;
  },

  async fetch(entry, ctx) {
    const key = resolvePaycomClientKey(entry);
    if (!key) throw new Error(`paycom: cannot derive client key for ${entry.name}`);

    const html = await ctx.fetchText(careerPageUrl(key), { headers: HEADERS, redirect: 'error' });
    const session = extractPaycomSession(html);
    if (!session) throw new Error(`paycom: no anonymous token or service url in the career page for ${entry.name}`);

    // The service URL comes from the page: keep it on paycomonline.net.
    let svcHost;
    try { svcHost = new URL(session.serviceUrl).hostname; } catch { throw new Error('paycom: bad service url'); }
    if (!svcHost.endsWith('.paycomonline.net')) throw new Error(`paycom: untrusted service host ${svcHost}`);

    const payload = await ctx.fetchJson(`${session.serviceUrl}api/ats/job-posting-previews/search`, {
      method: 'POST',
      headers: { ...HEADERS, authorization: session.jwt, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(SEARCH_BODY),
      redirect: 'error',
    });
    const jobs = parsePaycom(payload, key, entry.name);
    const total = payload.jobPostingPreviewsCount;
    if (typeof total === 'number' && total > payload.jobPostingPreviews.length) {
      console.warn(`paycom: ${entry.name} reports ${total} postings, read ${payload.jobPostingPreviews.length}`);
      markTruncated(jobs, 'page-cap', { fetched: payload.jobPostingPreviews.length, total });
    }
    return jobs;
  },
};

/** @returns {{ats_provider: string, board_slug: string, posting_id: string}|undefined} */
function paycomListingIdentity(clientKey, jobId) {
  let postingId;
  if (typeof jobId === 'number') {
    if (!Number.isSafeInteger(jobId) || jobId <= 0) return undefined;
    postingId = String(jobId);
  } else if (typeof jobId === 'string' && jobId !== '' && jobId === jobId.trim() && !/[\u0000-\u001f\u007f]/u.test(jobId)) {
    postingId = jobId;
  } else {
    return undefined;
  }
  return { ats_provider: 'paycom', board_slug: clientKey, posting_id: postingId };
}

/**
 * Map job-posting previews to Job[]. Exported for unit tests.
 *
 * @param {any} payload parsed JSON body of the search endpoint
 * @param {string} clientKey tenant client key, already checked against CLIENT_KEY_RE
 * @param {string} companyName value written into job.company
 */
export function parsePaycom(payload, clientKey, companyName) {
  const previews = payload && Array.isArray(payload.jobPostingPreviews) ? payload.jobPostingPreviews : null;
  if (!previews) {
    const got = payload && typeof payload === 'object' ? Object.keys(payload).join(', ') : typeof payload;
    throw new Error(`paycom: unexpected response — expected jobPostingPreviews[], got: [${got}]`);
  }
  const jobs = [];
  const seen = new Set();
  for (const p of previews) {
    const title = typeof p?.jobTitle === 'string' ? p.jobTitle.trim() : '';
    if (!title) continue;
    const jobId = p?.jobId;
    if (typeof jobId !== 'string' && typeof jobId !== 'number') continue;
    if (jobId === '') continue;
    const seg = safeEncodeURIComponent(String(jobId));
    if (seg === null) continue;
    const url = `${PAYCOM_ORIGIN}/v4/ats/web.php/portal/${clientKey}/jobs/${seg}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const location = typeof p?.locations === 'string' ? p.locations.trim() : '';
    const listingIdentity = paycomListingIdentity(clientKey, jobId);
    jobs.push({
      title,
      url,
      company: companyName,
      location,
      ...(listingIdentity ? { listingIdentity } : {}),
    });
  }
  return jobs;
}
