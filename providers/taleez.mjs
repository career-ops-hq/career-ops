// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { countryNameFromIso } from './_country.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Taleez provider — single-company ATS adapter for `tracked_companies:`.
// Taleez is a French ATS used mostly by French startups and SMEs. Each
// customer gets a careers site at `https://<tenant>.taleez.com`, and that
// site's front-end reads its whole configuration, open jobs included, from
// one public JSON endpoint on the same host: `/api/careez`. No login, no
// pagination: the `jobs` array is the complete list of published postings.
//
// Observed live (2026-11-13): animalis.taleez.com served 42 jobs in one
// response, liberty-rider.taleez.com 1, diabeloop.taleez.com 0 (an empty
// `jobs: []` on a live site). A tenant that no longer exists answers 404.
//
// Each posting's public page is `https://taleez.com/apply/<slug>`, on the
// vendor's main domain rather than the tenant's: that is the URL the careers
// site links to, and it serves a schema.org JobPosting. It is built from the
// payload's `slug`, never fetched here (the scanner stays zero-token).
//
// Auto-detects from careers_url `https://<tenant>.taleez.com[/...]`. Tenants
// are subdomains, so the SSRF guard is an anchored regex on the full hostname
// (same approach as breezy / bamboohr), minus the vendor's own subdomains.

const TALEEZ_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.taleez\.com$/;

// The vendor's own subdomains, all seen in taleez.com's certificate
// transparency log (crt.sh, 2026-11-13): never a customer careers site.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'blog', 'files', 'static', 'help', 'aide', 'status']);

const APPLY_BASE = 'https://taleez.com/apply/';

/**
 * The tenant subdomain of a Taleez careers-site hostname, or null.
 * @param {string} hostname
 * @returns {string | null}
 */
function tenantOf(hostname) {
  const m = TALEEZ_HOST_RE.exec(hostname);
  if (!m || RESERVED_SUBDOMAINS.has(m[1])) return null;
  return m[1];
}

/**
 * Resolve the tenant from an entry: an explicit `api:` URL wins, else
 * `careers_url`. Only the hostname is read; the input path is discarded.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveTenant(entry) {
  const rawApi = typeof entry?.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return tenantOf(parsed.hostname);
}

/** @param {string} tenant */
function apiUrlFor(tenant) {
  return `https://${tenant}.taleez.com/api/careez`;
}

/** @type {Provider} */
export default {
  id: 'taleez',

  detect(entry) {
    const tenant = resolveTenant(entry);
    return tenant ? { url: apiUrlFor(tenant) } : null;
  },

  async fetch(entry, ctx) {
    // The host check runs before any request: an entry that does not resolve
    // to a <tenant>.taleez.com careers site never reaches the network.
    const tenant = resolveTenant(entry);
    if (!tenant) {
      throw new Error(`taleez: cannot derive a <tenant>.taleez.com careers site for ${entry?.name}`);
    }
    // redirect:'error' keeps the request pinned to the tenant host (SSRF).
    const json = await ctx.fetchJson(apiUrlFor(tenant), { redirect: 'error' });
    return parseTaleezResponse(json, entry.name, tenant);
  },
};

/**
 * `listingIdentity` for a Taleez posting: the tenant subdomain is the board,
 * the payload's integer `id` the posting. Omitted when the id is not a
 * positive safe integer.
 * @param {string} tenant
 * @param {unknown} id
 */
export function taleezListingIdentity(tenant, id) {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return undefined;
  if (typeof tenant !== 'string' || !tenant) return undefined;
  return { ats_provider: 'taleez', board_slug: tenant, posting_id: String(id) };
}

/**
 * "City, Region, Country" from a Taleez location object. The country comes
 * as an ISO code ("FR") and is spelled out, so a location_filter written as
 * "France" can match it.
 * @param {any} loc
 */
function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const parts = [str(loc.city), str(loc.region), countryNameFromIso(loc.country) || str(loc.country)];
  /** @type {string[]} */
  const out = [];
  for (const p of parts) if (p && !out.includes(p)) out.push(p);
  return out.join(', ');
}

/**
 * A Taleez timestamp (epoch ms) or undefined.
 * @param {unknown} value
 */
function toEpochMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a `<tenant>.taleez.com/api/careez` response. Exported for unit tests.
 *
 * The site object carries the posting list as `jobs`:
 *   { name, url, ..., jobs: [{ id, label, slug, contract, lang, remote,
 *     publishDate, location: { city, region, country, ... } }] }
 *
 * - `jobs: []` is a live site with no open posting → [].
 * - Any body without a `jobs` array is not the documented shape → throw,
 *   naming the keys (or the type) received.
 * - A row without a usable `label` or `slug` is dropped, not fatal.
 * - `remote: true` appends "Remote" to the location string (as breezy does
 *   for `is_remote`); `workplaceType` is not set from it.
 * - postedAt is `creationDate`, falling back to `publishDate`. Taleez bumps
 *   `publishDate` every time a posting is re-published (observed live: 10 of
 *   42 postings on one board more than a day apart, the widest 377 days),
 *   while the posting page's own JSON-LD `datePosted` is `creationDate`.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} tenant
 */
export function parseTaleezResponse(json, companyName, tenant) {
  const rows = json && typeof json === 'object' && Array.isArray(json.jobs) ? json.jobs : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : json === null ? 'null' : typeof json;
    throw new Error(`taleez: unexpected response for ${companyName} — expected a site object with jobs[], got: [${got}]`);
  }
  const out = [];
  for (const j of rows) {
    if (!j || typeof j !== 'object') continue;
    const title = typeof j.label === 'string' ? j.label.trim() : '';
    if (!title) continue;
    const slug = typeof j.slug === 'string' ? j.slug.trim() : '';
    const seg = slug ? safeEncodeURIComponent(slug) : null;
    if (!seg) continue;

    const base = formatLocation(j.location);
    const location = j.remote === true && !/\bremote\b/i.test(base) ? [base, 'Remote'].filter(Boolean).join(', ') : base;

    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: APPLY_BASE + seg,
      company: companyName,
      location,
    };
    const postedAt = toEpochMs(j.creationDate) ?? toEpochMs(j.publishDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    if (typeof j.lang === 'string' && j.lang.trim()) job.language = j.lang.trim();
    const identity = taleezListingIdentity(tenant, j.id);
    if (identity) {
      job.listingIdentity = identity;
      job.externalId = identity.posting_id;
    }
    out.push(job);
  }
  return out;
}
