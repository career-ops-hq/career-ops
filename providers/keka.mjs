// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, fetchTextWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Keka provider — a single-company ATS adapter (→ tracked_companies:). Keka
// is an HR/ATS platform used by many mid-size employers in India; each tenant
// has a careers page at `https://<tenant>.keka.com/careers`.
//
// That page is a thin shell: a script on it fetches a static HTML fragment
// from `/ats/documents/<identifier>/careerportal/<hash>.html`, where
// `<identifier>` is a UUID unique to the tenant. The same UUID keys the
// zero-auth JSON feed the embeddable job widget reads:
//
//   GET https://<tenant>.keka.com/careers/api/embedjobs/default/active/<identifier>
//   → [{ id, title, description, jobLocations: [{ name, city, state,
//        countryName }], publishedOn, ... }]
//
// So a fetch is two requests, neither needing JavaScript:
//   1. GET /careers → read the identifier out of the fragment path.
//   2. GET the feed above → one top-level array holding every open posting.
// Step 1 sits outside any page count (it carries no listings). The feed is not
// paginated, so there is no page loop and `ctx.maxPages` has nothing to cap.
//
// Detection: `<tenant>.keka.com` is a wildcard-tenant host, so it is matched
// with an anchored full-host regex rather than a Set. Only the hostname is
// taken from `careers_url` / `api`; the request URL is rebuilt as
// `https://<hostname>` plus this provider's own fixed paths, so a port or a
// path in the input never reaches the fetch. `www.keka.com` and the vendor's
// other own subdomains are not tenants and are never claimed.
//
// An unknown tenant answers `GET /careers` with a 302 to
// `/careers/Content/TenantNotFound.html`; that is read (never followed) and
// reported as a missing tenant rather than a generic redirect failure.

const KEKA_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.keka\.com$/;

// Subdomains Keka itself runs. None of them is a customer tenant.
const RESERVED_LABELS = new Set(['www', 'app', 'api', 'help', 'support', 'blog', 'docs', 'status', 'mail', 'developers']);

// The identifier UUID as it appears in the shell's fragment path:
//   /ats/documents/<uuid>/careerportal/<hash>.html
const IDENTIFIER_RE = /\/ats\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/careerportal\//i;

/**
 * The tenant origin (`https://<tenant>.keka.com`) for an entry, or null. Only
 * the hostname of `api` / `careers_url` is used; its path and port are dropped.
 * @param {any} entry
 * @returns {string | null}
 */
export function resolveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    const host = parsed.hostname.toLowerCase();
    if (!KEKA_HOST_RE.test(host)) continue;
    if (RESERVED_LABELS.has(host.slice(0, -'.keka.com'.length))) continue;
    return `https://${host}`;
  }
  return null;
}

/** @param {unknown} value @returns {number | undefined} */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * "City, Country" per location, joined with "; ". `name` is the employer's
 * internal office label ("HQ - Tower 2"), so it is only the fallback.
 * @param {any} row
 * @returns {string}
 */
export function jobLocation(row) {
  const locs = Array.isArray(row?.jobLocations) ? row.jobLocations : [];
  const parts = [];
  for (const loc of locs) {
    if (!loc || typeof loc !== 'object') continue;
    const place = [loc.city, loc.countryName]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean)
      .join(', ');
    const label = place || (typeof loc.name === 'string' ? loc.name.trim() : '');
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts.join('; ');
}

/**
 * Read the feed identifier out of a careers-page shell.
 * @param {unknown} html
 * @returns {string | null}
 */
export function extractIdentifier(html) {
  const m = typeof html === 'string' ? html.match(IDENTIFIER_RE) : null;
  return m ? m[1].toLowerCase() : null;
}

/**
 * Parse an `embedjobs` response. Exported for unit tests.
 *
 * The documented envelope is a top-level array: `[]` is an empty board, and
 * anything else (an object, a string, null) throws so a silent API change does
 * not read as zero postings forever. A single malformed row is dropped.
 *
 * Posting URL: `<origin>/careers/jobdetails/<id>`, the tenant's public detail
 * page. A row with no title, or whose id cannot be encoded, has no stable URL
 * (and `url` is the scanner's dedup key), so it is skipped.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin  e.g. "https://acme.keka.com"
 * @returns {import('./_types.js').Job[]}
 */
export function parseKekaResponse(json, companyName, origin) {
  if (!Array.isArray(json)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`keka: unexpected response — expected a jobs array, got: [${got}]`);
  }
  const jobs = [];
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
    const id = coerceId(row.id);
    if (!title || id === undefined) continue;
    // A lone surrogate in a host-controlled id would throw out of this loop
    // and lose the whole board; drop just that posting instead.
    const seg = safeEncodeURIComponent(id);
    if (seg === null) continue;
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `${origin}/careers/jobdetails/${seg}`,
      company: companyName,
      location: jobLocation(row),
    };
    const postedAt = toEpochMs(row.publishedOn);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const description = htmlToText(row.description);
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'keka',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/careers` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) {
      throw new Error(`keka: cannot derive a <tenant>.keka.com host for ${entry?.name} — set careers_url to https://<tenant>.keka.com/careers`);
    }

    // 'manual' only to read the 302 an unknown tenant answers with; it is
    // never followed. Any other failure propagates unwrapped, so a dead
    // tenant reads as broken and ProbePageBudgetReached keeps its identity.
    let shell;
    try {
      shell = await fetchTextWithRetry(ctx, `${origin}/careers`, { redirect: 'manual' });
    } catch (err) {
      if (err?.status >= 300 && err?.status < 400) {
        const e = new Error(`keka: ${entry.name} careers page redirected (${err.status} -> ${err.location}) — no such tenant`);
        /** @type {any} */ (e).status = 404;
        throw e;
      }
      throw err;
    }

    // Fail closed: a missing identifier means Keka changed the shell, not that
    // the board is empty.
    const identifier = extractIdentifier(shell);
    if (!identifier) {
      throw new Error(`keka: ${entry.name} careers page is missing the embedjobs identifier (structure changed?)`);
    }

    const json = await fetchJsonWithRetry(ctx, `${origin}/careers/api/embedjobs/default/active/${identifier}`, { redirect: 'error' });
    return parseKekaResponse(json, entry.name, origin);
  },
};
