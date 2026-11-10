// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { cachedLookup } from './_cached-lookup.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchJsonWithRetry } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// TurboHire provider: single-company ATS adapter for `tracked_companies:`.
// Auto-detects a tenant careers site, https://<tenant>.turbohire.co (any
// path, so a /job/publicjobs/<id> posting link resolves to its board).
//
// The careers page is a client-side app. This makes the same three zero-auth
// requests the page makes for every visitor, all to TurboHire's API host:
//
//   1. GET  /api/token/noauth: the anonymous token the page fetches before
//      anything else. It answers 403 "Invalid request." unless the request
//      carries the careers page's Origin and Referer, which a visitor's browser
//      sends with it, so this request sends the tenant's own origin. The later
//      requests do not need them.
//   2. GET  /api/publicorganizations?accountName=<tenant>: the tenant's org id.
//      An unknown tenant answers 404. The id is kept in `ctx.idCache`.
//   3. POST /api/careerpagev2/filteredjobs?orgId=<id>&pageType=0 with `{}`:
//      every posting on the public careers page, in one response (no
//      pagination), with the description inline.
//
// pageType 0 is the public careers page, the value the careers page itself
// sends. The API takes other values for boards a visitor does not see; this
// provider never requests them.
//
// Each row also names the recruiter who created the posting. Only the fields
// mapped below are read, so nothing else from a row is kept.

const API_ORIGIN = 'https://thapi.azurewebsites.net';
const PAGE_TYPE_CAREER_PAGE = 0;

const TENANT_HOST_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.turbohire\.co$/;
// TurboHire's own hosts: the recruiter app, the reports API and the website.
const VENDOR_LABELS = new Set(['app', 'api', 'www']);
const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = '00000000-0000-0000-0000-000000000000';
// What a row carries in ClientName when the posting hides its end employer.
const HIDDEN_CLIENT = '[REDACTED]';

/**
 * The tenant subdomain and careers-site origin for an entry, or null.
 * @param {any} entry
 * @returns {{tenant: string, origin: string} | null}
 */
export function resolveTenant(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    const m = parsed.hostname.match(TENANT_HOST_RE);
    if (!m || VENDOR_LABELS.has(m[1])) continue;
    return { tenant: m[1], origin: `https://${m[1]}.turbohire.co` };
  }
  return null;
}

/** @param {unknown} value @returns {boolean} */
function isOrgId(value) {
  return typeof value === 'string' && ORG_ID_RE.test(value) && value !== NIL_GUID;
}

/** @param {unknown} json @returns {string} */
function describeKeys(json) {
  if (json && typeof json === 'object' && !Array.isArray(json)) return `[${Object.keys(json).join(', ')}]`;
  return Array.isArray(json) ? 'an array' : typeof json;
}

/**
 * The URL path segment for a posting id. TurboHire ships the obfuscated id
 * already percent-encoded (a base64 `/` arrives as `%2F`) and puts it in the
 * link unchanged, so it is decoded once and re-encoded through the shared
 * helper, which gives back the same text. A malformed escape or a lone
 * surrogate cannot become a working link, so that posting is dropped (null).
 * @param {unknown} raw
 * @returns {string | null}
 */
export function postingSegment(raw) {
  const id = coerceId(raw);
  if (id === undefined) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    return null;
  }
  return safeEncodeURIComponent(decoded);
}

/**
 * Every listed site, joined with "; ". `Location` is a JSON string holding an
 * array of `{Address}` objects; an already-parsed array is accepted too.
 * @param {unknown} raw
 * @returns {string}
 */
export function jobLocation(raw) {
  let sites = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return '';
    try {
      sites = JSON.parse(text);
    } catch {
      // Not JSON: a plain address string is still a location; broken JSON is not.
      return text.startsWith('[') || text.startsWith('{') ? '' : decodeEntities(text).replace(/\s+/g, ' ').trim();
    }
  }
  if (!Array.isArray(sites)) return '';
  /** @type {string[]} */
  const parts = [];
  for (const site of sites) {
    const address = site && typeof site === 'object' ? site.Address : undefined;
    if (typeof address !== 'string') continue;
    const label = decodeEntities(address).replace(/\s+/g, ' ').trim();
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts.join('; ');
}

/** @param {string} name @returns {string} */
function compactName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The employer a posting names. A group tenant can show the subsidiary that is
 * hiring (`ShowClientName`, `ClientName`); otherwise the entry's own name. A
 * client name that is only the entry's name spelled differently ("TataMotors"
 * @param {any} row
 * @param {string} fallback
 * @returns {string}
 */
export function employerName(row, fallback) {
  if (row?.ShowClientName === true && typeof row.ClientName === 'string') {
    const name = decodeEntities(row.ClientName).replace(/\s+/g, ' ').trim();
    const sameAsEntry = typeof fallback === 'string' && compactName(name) === compactName(fallback);
    if (name && name !== HIDDEN_CLIENT && !sameAsEntry) return name;
  }
  return fallback;
}

/**
 * `PublishedDate` is an ISO timestamp in UTC. `UpdatedDate` has no zone and
 * moves on every edit, so it is not read.
 * @param {any} row
 * @returns {number | undefined}
 */
function postedAtMs(row) {
  if (typeof row?.PublishedDate !== 'string' || !row.PublishedDate) return undefined;
  const parsed = Date.parse(row.PublishedDate);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a `filteredjobs` response. Exported for unit tests.
 *
 * `{Result: []}` is an empty board; any other envelope throws, so a silent API
 * change does not read as zero postings forever. A single malformed row is
 * dropped.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {{tenant: string, origin: string}} board
 * @returns {import('./_types.js').Job[]}
 */
export function parseTurbohireResponse(json, companyName, board) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.Result)) {
    throw new Error(`turbohire: unexpected response — expected a Result array, got: ${describeKeys(json)}`);
  }
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  const seen = new Set();
  for (const row of json.Result) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.JobTitle === 'string' ? decodeEntities(row.JobTitle).replace(/\s+/g, ' ').trim() : '';
    const seg = postingSegment(row.JobIdObfuscated);
    if (!title || seg === null) continue;
    const url = `${board.origin}/job/publicjobs/${seg}`;
    if (seen.has(url)) continue;
    seen.add(url);
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url,
      company: employerName(row, companyName),
      location: jobLocation(row.Location),
    };
    const postedAt = postedAtMs(row);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const requisitionId = coerceId(row.JobCode);
    if (requisitionId !== undefined) job.requisitionId = requisitionId;
    const description = htmlToText(row.JobDescV2);
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}

/**
 * The anonymous token, requested with the careers page's Origin and Referer.
 * @param {any} ctx
 * @param {{tenant: string, origin: string}} board
 * @returns {Promise<string>}
 */
async function anonymousToken(ctx, board) {
  const json = await fetchJsonWithRetry(ctx, `${API_ORIGIN}/api/token/noauth`, {
    redirect: 'error',
    headers: { accept: 'application/json', origin: board.origin, referer: `${board.origin}/` },
  });
  const token = /** @type {any} */ (json)?.access_token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error(`turbohire: the anonymous token request returned no access_token, got: ${describeKeys(json)}`);
  }
  return token.trim();
}

/**
 * The tenant's org id. A 404 means no such tenant: the error says so and keeps
 * its status, so the cached id is dropped.
 * @param {any} ctx
 * @param {{tenant: string, origin: string}} board
 * @param {string} token
 * @returns {Promise<string>}
 */
async function lookupOrgId(ctx, board, token) {
  let json;
  try {
    json = await fetchJsonWithRetry(ctx, `${API_ORIGIN}/api/publicorganizations?accountName=${board.tenant}`, {
      redirect: 'error',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (/** @type {any} */ (err)?.status === 404) {
      throw Object.assign(new Error(`turbohire: no TurboHire tenant "${board.tenant}" (the organization lookup answered 404)`), { status: 404 });
    }
    throw err;
  }
  const orgId = /** @type {any} */ (json)?.OrgID;
  if (!isOrgId(orgId)) {
    throw new Error(`turbohire: the organization lookup for "${board.tenant}" returned no org id, got: ${describeKeys(json)}`);
  }
  return orgId;
}

/** @type {Provider} */
export default {
  id: 'turbohire',

  detect(entry) {
    const board = resolveTenant(entry);
    return board ? { url: `${board.origin}/` } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveTenant(entry);
    if (!board) {
      throw new Error(`turbohire: cannot derive a tenant for ${entry?.name} — set careers_url to https://<tenant>.turbohire.co/`);
    }
    const token = await anonymousToken(ctx, board);
    const orgId = await cachedLookup(ctx?.idCache, board.tenant, () => lookupOrgId(ctx, board, token), {
      isValid: isOrgId,
      isGone: (err) => err?.status === 404,
    });
    const json = await fetchJsonWithRetry(
      ctx,
      `${API_ORIGIN}/api/careerpagev2/filteredjobs?orgId=${orgId}&pageType=${PAGE_TYPE_CAREER_PAGE}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{}',
      },
    );
    const jobs = parseTurbohireResponse(json, entry.name, board);
    const total = /** @type {any} */ (json).Total;
    if (Number.isFinite(total) && total > json.Result.length) {
      console.error(`⚠️  turbohire: ${entry.name} returned ${json.Result.length} of ${total} postings in one response`);
    }
    return jobs;
  },
};
