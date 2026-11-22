// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { safeEncodeURIComponent } from './_safe-url.mjs';
import { workplaceField } from './_workplace-type.mjs';

// InHire provider: the public per-tenant job list of InHire, a Brazilian ATS.
// Target list: `tracked_companies:` (one entry per employer). Auto-detects
// `https://<tenant>.inhire.app[/...]`, the employer's career page.
//
//   GET https://api.inhire.app/job-posts/public/pages   header X-Tenant: <tenant>
//   -> { tenantName, about, logo, ..., jobsPage: [ { jobId, displayName,
//        status, workplaceType, location, careerPageId, careerPageIds } ] }
//
// The API host is a fixed literal; the tenant is the only config-derived part.
// It is read from the hostname of careers_url/api, anchored to
// <tenant>.inhire.app, and travels in the X-Tenant header and in the posting
// URL host, so it is validated before any request.
//
// List only. The list carries title, location, workplace type and status, but
// no publish date and no description; those live behind one request per
// posting (/job-posts/public/pages/<jobId>), which this provider does not make,
// so the scan stays one request per tenant (same choice as bamboohr.mjs).
// postedAt and description are therefore omitted.
//
// Observed live on 2026-11-17 across five tenants (808 postings): every
// posting arrived in a single response (no pagination parameters, no partial
// pages), every row had status "published", workplaceType was one of Hybrid /
// Remote / On-site, and some titles carry leading or trailing spaces.
//
// Response cases:
//   - jobsPage: []                 -> live tenant with nothing open, returns [].
//   - jobsPage missing / not array -> changed API, descriptive throw.
//   - HTTP 404 {"message":"Tenant not found"} -> unknown tenant, or an employer
//     that left InHire; rethrown with status 404 so dead-boards.mjs can cache it.
//   - HTTP 400 is what the API answers without X-Tenant; never sent here.
//
// Source Indexing Policy: single-company ATS adapter. Postings are the
// employer's own, zero-auth, and the URL is the posting on the employer's
// InHire career page, <tenant>.inhire.app/vagas/<jobId>/<slug>, the form the
// career page itself links to.

const API_URL = 'https://api.inhire.app/job-posts/public/pages';
const INHIRE_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.inhire\.app$/;
// Subdomains InHire uses for itself, not career pages.
const NON_TENANT_HOSTS = new Set(['api', 'www', 'files']);

/**
 * The tenant from an entry's api/careers_url hostname, or null when the URL is
 * not https://<tenant>.inhire.app. Only the hostname is read; path, query and
 * port are discarded. Exported for unit tests.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveInhireTenant(entry) {
  const raw = (typeof entry?.api === 'string' && entry.api.trim()) || (typeof entry?.careers_url === 'string' && entry.careers_url.trim()) || '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const tenant = INHIRE_HOST_RE.exec(parsed.hostname)?.[1];
  if (!tenant || NON_TENANT_HOSTS.has(tenant)) return null;
  return tenant;
}

/** @param {string} title */
function slugify(title) {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vaga';
}

/**
 * The posting's ATS-native identity: the tenant and the payload's jobId (a
 * UUID string), never parsed out of the URL, whose slug follows the title.
 * Undefined for an id that is not a non-empty string, is padded, or carries a
 * control character, so that row falls back to URL dedup. Exported for tests.
 *
 * @param {string} tenant
 * @param {unknown} id
 * @returns {{ats_provider: 'inhire', board_slug: string, posting_id: string} | undefined}
 */
export function inhireListingIdentity(tenant, id) {
  if (typeof tenant !== 'string' || !INHIRE_HOST_RE.test(`${tenant}.inhire.app`)) return undefined;
  if (typeof id !== 'string' || id === '' || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id)) return undefined;
  return { ats_provider: 'inhire', board_slug: tenant, posting_id: id };
}

/**
 * Parse the list response. Exported for unit tests.
 *
 * Rows are dropped, never thrown on, when they are not objects, are not
 * "published", or lack a usable jobId or title.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} tenant
 */
export function parseInhireResponse(json, companyName, tenant) {
  const rows = json && Array.isArray(json.jobsPage) ? json.jobsPage : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : json === null ? 'null' : typeof json;
    throw new Error(`inhire: unexpected response for ${companyName} — expected jobsPage[], got: [${got}]`);
  }
  const company = companyName || (typeof json.tenantName === 'string' ? json.tenantName.trim() : '');
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.status !== 'published') continue;
    const title = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    const id = typeof row.jobId === 'string' ? row.jobId.trim() : '';
    if (!title || !id) continue;
    const segment = safeEncodeURIComponent(id);
    if (segment === null) continue;
    const listingIdentity = inhireListingIdentity(tenant, row.jobId);
    jobs.push({
      title,
      url: `https://${tenant}.inhire.app/vagas/${segment}/${slugify(title)}`,
      company,
      location: typeof row.location === 'string' ? row.location.trim() : '',
      ...workplaceField(row.workplaceType),
      ...(listingIdentity ? { listingIdentity } : {}),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'inhire',

  detect(entry) {
    const tenant = resolveInhireTenant(entry);
    return tenant ? { url: `https://${tenant}.inhire.app` } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveInhireTenant(entry);
    if (!tenant) throw new Error(`inhire: cannot derive tenant for ${entry?.name} — careers_url must be https://<tenant>.inhire.app`);
    let json;
    try {
      json = await ctx.fetchJson(API_URL, { headers: { 'X-Tenant': tenant }, redirect: 'error' });
    } catch (err) {
      if (err?.status === 404) {
        const dead = new Error(`inhire: tenant "${tenant}" not found (404) — wrong careers_url, or the employer left InHire`);
        /** @type {any} */ (dead).status = 404;
        throw dead;
      }
      throw err;
    }
    return parseInhireResponse(json, entry.name, tenant);
  },
};
