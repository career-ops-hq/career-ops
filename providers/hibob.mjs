// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// HiBob (hibob.com, the HR software company) — the careers sites its "Bob"
// hiring module hosts for each customer, one tenant per `tracked_companies:`
// entry:
//
//   - name: Acme
//     careers_url: https://acme.careers.hibob.com/jobs
//
// A tenant is one label under `careers.hibob.com`. Some labels carry a suffix
// HiBob adds (`acme-641e1b39232b`); the label is used exactly as the host
// shows it. Any path on the tenant host is claimed, so a posting link
// (`/jobs/<uuid>`) or an apply link (`/jobs/<uuid>/apply`) found in a search
// result works as well as the board root.
//
// The board page is a single-page app shell. The app reads every posting from
// one JSON endpoint on the tenant host:
//
//   GET https://<tenant>.careers.hibob.com/api/job-ad
//   companyidentifier: <tenant>
//
// The `companyidentifier` header names the tenant (the request is refused
// without it) and is the tenant label in lower case, the same value the app
// sends. No cookie, token or login is involved. The answer is
// `{ filterGroups, jobAdDetails: [...], jobOpeningMetadata }`, with every
// posting in `jobAdDetails` and no pagination: the page renders the list in a
// virtual scroll over that one array. Each posting carries its full text
// (description, responsibilities, requirements, benefits), so one request
// also fills `description`; at roughly 8 KB per posting the body can exceed
// the shared 10 MB default on a large board, hence MAX_BODY_BYTES. An entry's
// `max_response_mb` in portals.yml overrides it.
//
// A posting may carry a pay range (`payTransparencyMinSalary`,
// `payTransparencyMaxSalary`, `payTransparencySalaryCurrency`,
// `payTransparencySalaryPayPeriod`); the page shows it as
// "48,000 – 55,000 EUR Annual". It becomes `salary` only when the period is
// `Annual`, the one value seen on the tenants read; any other period leaves it
// off rather than guess a multiplier. A bound of 0 means "not set".
//
// A label that is not a tenant answers 401 with an HTML error page; that is
// reported as a 404 ("no such careers site") so verify-portals and the
// dead-board cache read it as a missing board rather than an auth wall. Some
// labels answer 404 with a JSON error body instead; that error passes through
// unchanged.

import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const HIBOB_CAREERS_SUFFIX = '.careers.hibob.com';
const TENANT_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * The tenant label of a HiBob careers URL, or null when the URL is not one.
 * Only the hostname is read; the path, query and port are ignored.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function resolveHibobTenant(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(HIBOB_CAREERS_SUFFIX)) return null;
  const tenant = host.slice(0, -HIBOB_CAREERS_SUFFIX.length);
  return TENANT_LABEL_RE.test(tenant) ? tenant : null;
}

/** @param {{ api?: unknown, careers_url?: unknown } | null | undefined} entry */
function tenantOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return resolveHibobTenant(entry.api) || resolveHibobTenant(entry.careers_url);
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Annual salary of a posting, or null when it states no usable figure.
 * A one-sided range fills the other bound from it, like `ashby.mjs`.
 * @param {any} row
 * @returns {{min: number, max: number, currency: string} | null}
 */
export function parseHibobSalary(row) {
  if (str(row?.payTransparencySalaryPayPeriod).toLowerCase() !== 'annual') return null;
  /** @param {unknown} v */
  const amount = (v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const min = amount(row.payTransparencyMinSalary);
  const max = amount(row.payTransparencyMaxSalary);
  if (min == null && max == null) return null;
  const low = /** @type {number} */ (min ?? max);
  const high = /** @type {number} */ (max ?? min);
  return { min: Math.min(low, high), max: Math.max(low, high), currency: str(row.payTransparencySalaryCurrency).toUpperCase() };
}

/**
 * "<site>, <country>", with the country left out when the site name already
 * contains it, and "Remote" added for a remote posting whose site does not
 * say so.
 * @param {any} row
 */
function locationOf(row) {
  const site = str(row.site);
  const country = str(row.country);
  const parts = [site];
  if (country && !site.toLowerCase().includes(country.toLowerCase())) parts.push(country);
  if (str(row.workspaceTypeId) === 'remote' && !/\bremote\b/i.test(site)) parts.push('Remote');
  return parts.filter(Boolean).join(', ');
}

/**
 * Parses an `/api/job-ad` answer. Exported for unit tests.
 *
 * Throws when `jobAdDetails` is not an array (the envelope changed); an empty
 * array is an empty board. A row without a title or a usable id is skipped.
 *
 * @param {any} json
 * @param {string} origin - `https://<tenant>.careers.hibob.com`
 * @param {string} company
 * @returns {Job[]}
 */
export function parseHibobJobAds(json, origin, company) {
  const rows = json && typeof json === 'object' && Array.isArray(json.jobAdDetails) ? json.jobAdDetails : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`hibob: unexpected response from ${origin}/api/job-ad — expected jobAdDetails[], got: [${got}]`);
  }
  /** @type {Job[]} */
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = str(row.title);
    const id = str(row.id);
    if (!title || !id) continue;
    const seg = safeEncodeURIComponent(id);
    if (seg === null) continue;
    /** @type {Job} */
    const job = { title, url: `${origin}/jobs/${seg}`, company, location: locationOf(row) };
    const postedAt = toEpochMs(row.publishedAt);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const language = str(row.language);
    if (language) job.language = language;
    const salary = parseHibobSalary(row);
    if (salary) job.salary = salary;
    const description = htmlToText(
      ['description', 'responsibilities', 'requirements', 'benefits']
        .map((key) => (typeof row[key] === 'string' ? row[key] : ''))
        .filter(Boolean)
        .join('<br>'),
    );
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'hibob',

  /**
   * Claims an entry whose careers_url (or api) is on a HiBob tenant host.
   * @param {{ careers_url?: unknown, api?: unknown }} entry
   */
  detect(entry) {
    const tenant = tenantOf(entry);
    return tenant ? { url: `https://${tenant}${HIBOB_CAREERS_SUFFIX}/api/job-ad` } : null;
  },

  /**
   * One request for the whole board. The origin is rebuilt from the tenant
   * label alone, so no path or port from the entry reaches the request.
   * @param {{ name?: string, careers_url?: unknown, api?: unknown }} entry
   * @param {import('./_types.js').Context} ctx
   */
  async fetch(entry, ctx) {
    const tenant = tenantOf(entry);
    if (!tenant) {
      throw new Error(`hibob: ${entry?.name ?? 'entry'} is not a HiBob careers site (https://<tenant>.careers.hibob.com)`);
    }
    const origin = `https://${tenant}${HIBOB_CAREERS_SUFFIX}`;
    let json;
    try {
      json = await ctx.fetchJson(`${origin}/api/job-ad`, {
        redirect: 'error',
        headers: { accept: 'application/json', companyidentifier: tenant },
        maxBytes: MAX_BODY_BYTES,
      });
    } catch (err) {
      if (/** @type {any} */ (err)?.status === 401) {
        // The message leaves out the tenant label: verify-portals reads the
        // word "network" anywhere in a message as a network failure, and a
        // label may contain that word.
        const gone = /** @type {Error & { status?: number }} */ (
          new Error('hibob: not a HiBob careers site (HTTP 401) — check the tenant label in careers_url')
        );
        gone.status = 404;
        throw gone;
      }
      throw err;
    }
    return parseHibobJobAds(json, origin, String(entry?.name ?? ''));
  },
};
