// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PrevueAPS provider — single-company ATS adapter, one entry per tenant under
// `tracked_companies:` (a per-employer careers page, mirroring recruitee.mjs /
// breezy.mjs — not a job-board aggregator, so the Source Indexing Policy's
// board-eligibility gate does not apply).
//
// Auto-detects from careers_url pattern `https://<tenant>.prevueaps.ca[/...]`.
// Per-tenant subdomains are the variable part, so SSRF defence uses a regex
// match on `<safe-tenant>.prevueaps.ca` rather than a static allowlist (same
// approach as recruitee.mjs / breezy.mjs).
//
// ── The non-obvious part: domainId resolution ──
//
// PrevueAPS's public JSON endpoint is NOT keyed by the tenant subdomain — it
// is keyed by a small numeric per-tenant site ID that only appears embedded
// in the tenant's own `/jobs/` HTML page:
//
//   GET https://{tenant}.prevueaps.ca/core/jobs/{domainId}?getParams={...}
//
// Verified live 2026-09-05 against tbca.prevueaps.ca (domainId 889) and
// demo.prevueaps.ca (domainId 813): the tenant's own front-end JS constructs
// exactly this `/core/jobs/{id}` URL and the numeric id appears literally in
// the page's inline script/markup near where that call is built. This
// provider fetches `/jobs/` once per run and extracts the id by trying,
// in order, the most direct signal first:
//
//   1. a literal `/core/jobs/<digits>` path appearing anywhere in the HTML
//      (the page's own JS already assembled the exact URL we want to call —
//      this is the strongest signal, since it is the same string this
//      provider itself needs to build)
//   2. a `data-domain-id="<digits>"` attribute
//   3. a `domainId` JS identifier assigned/quoted to a number
//      (`domainId: 889`, `domainId = "889"`, `"domainId":889`)
//   4. a `siteId` JS identifier in the same shapes (the JSON job payload
//      itself calls this field `siteId`, and some tenant pages appear to
//      surface it under that name pre-fetch too)
//
// This resolver is a best-effort reading of a real captured response's
// shape, not a confirmed reading of the `/jobs/` page's own markup for every
// tenant — only the JSON endpoint's shape was captured directly. If a tenant
// ever fails to resolve, `fetch()` throws with the tenant name so the gap is
// visible in a scan run rather than silently producing zero jobs.
//
// `getParams` is a display/formatting-hints payload (which columns the page
// itself renders — showDate, showLocation, etc.), not a query filter, per
// the endpoint's own response shape (the full job record comes back
// regardless of which flags are set). A fixed, safe constant is used here
// rather than a minimized guess, since no live network access was available
// in this environment to confirm a trimmed payload still returns full data.

const PREVUEAPS_HOST_RE = /^[a-z0-9][a-z0-9-]*\.prevueaps\.ca$/;

// Observed getParams shape (display/formatting hints only — see header
// comment). Kept as the full observed constant rather than a trimmed guess.
const DEFAULT_GET_PARAMS = {
  showDate: true,
  showLocation: true,
  showEmploymentType: true,
  showCategory: true,
  showClassification: true,
  showWorkplaceType: true,
  customCategoryTitle: '',
};

/** @param {string} url */
function assertPrevueapsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`prevueaps: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`prevueaps: URL must use HTTPS: ${url}`);
  if (!PREVUEAPS_HOST_RE.test(parsed.hostname)) {
    throw new Error(`prevueaps: untrusted hostname "${parsed.hostname}" — must match <tenant>.prevueaps.ca`);
  }
  return url;
}

/**
 * Resolve the tenant origin (`https://<tenant>.prevueaps.ca`) from an entry.
 * Honours an explicit `api:` URL, else parses `careers_url`.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const rawApi = typeof entry.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!PREVUEAPS_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}`;
}

/**
 * Extract the numeric domainId from a tenant's `/jobs/` HTML page.
 * Exported for unit testing. Returns null when no pattern matches.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractDomainId(html) {
  if (typeof html !== 'string' || !html) return null;

  // 1. A literal /core/jobs/<digits> path — the page's own JS already built
  //    the exact API URL this provider needs.
  let m = html.match(/\/core\/jobs\/(\d+)/);
  if (m) return m[1];

  // 2. data-domain-id="<digits>" attribute.
  m = html.match(/data-domain-id\s*=\s*["'](\d+)["']/i);
  if (m) return m[1];

  // 3. A `domainId` JS identifier assigned/quoted to a number:
  //    domainId: 889 / domainId = "889" / "domainId":889
  m = html.match(/["']?domainId["']?\s*[:=]\s*["']?(\d+)["']?/i);
  if (m) return m[1];

  // 4. A `siteId` JS identifier in the same shapes.
  m = html.match(/["']?siteId["']?\s*[:=]\s*["']?(\d+)["']?/i);
  if (m) return m[1];

  return null;
}

/**
 * Build the /core/jobs/{domainId} API URL for a tenant origin.
 * @param {string} origin
 * @param {string} domainId
 */
function buildApiUrl(origin, domainId) {
  const getParams = encodeURIComponent(JSON.stringify(DEFAULT_GET_PARAMS));
  return `${origin}/core/jobs/${domainId}?getParams=${getParams}`;
}

/** @type {Provider} */
export default {
  id: 'prevueaps',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/jobs/` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`prevueaps: cannot derive tenant origin for ${entry.name}`);
    const jobsPageUrl = `${origin}/jobs/`;
    assertPrevueapsUrl(jobsPageUrl);
    // redirect:'error' + the host check above keep the final hostname pinned
    // to the tenant — a server-side redirect can't bounce us off-domain
    // (SSRF), for both requests below.
    const html = await ctx.fetchText(jobsPageUrl, { redirect: 'error' });
    const domainId = extractDomainId(/** @type {string} */ (html));
    if (!domainId) {
      throw new Error(`prevueaps: could not resolve domainId for ${entry.name} from ${jobsPageUrl}`);
    }
    const apiUrl = buildApiUrl(origin, domainId);
    assertPrevueapsUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parsePrevueapsResponse(json, entry.name);
  },
};

/**
 * Parse a PrevueAPS `/core/jobs/{domainId}` response. Exported for unit tests.
 *
 * PrevueAPS returns:
 *   { success: true, data: { jobs: [{ title, jobUrl, jobLocation, city,
 *     stateName, abbreviation, employmentType, payType, payTypeFrame,
 *     minSalary, maxSalary, ... }], jobCount } }
 * or, for a tenant with zero open jobs:
 *   { success: true, message: "No job found", data: { jobs: [], jobCount: 0 } }
 *
 * - url: `jobUrl` is the tenant's own absolute posting URL
 *   (`https://<tenant>.prevueaps.ca/jobs/<id>`) — this IS the employer's own
 *   posting page (a single-company ATS adapter, not an aggregator with a
 *   separate upstream link), so it is used directly as the Job contract's
 *   dedup key. Only a well-formed `https:` URL is kept; a non-https or
 *   malformed/missing URL drops the row.
 * - location: prefer the ready-made `jobLocation`; else assemble from
 *   city/abbreviation (province)/stateName.
 * - description: PrevueAPS's list payload does not carry a job body — pay
 *   and employment-type details are folded into `description` instead, since
 *   they are already present in the list response at zero extra cost and
 *   feed scan.mjs's content_filter the same way a body would.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string}>}
 */
export function parsePrevueapsResponse(json, companyName) {
  const jobs = json?.data?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out = [];
  for (const j of jobs) {
    if (!j || !j.title) continue;

    let url = '';
    const rawUrl = typeof j.jobUrl === 'string' ? j.jobUrl : '';
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:') url = parsed.href;
      } catch { /* malformed → drop */ }
    }
    if (!url) continue;

    const location = (typeof j.jobLocation === 'string' && j.jobLocation.trim())
      ? j.jobLocation.trim()
      : [j.city, j.abbreviation || j.stateName].filter(Boolean).join(', ');

    const descBits = [];
    if (typeof j.employmentType === 'string' && j.employmentType.trim()) descBits.push(j.employmentType.trim());
    if (typeof j.classification === 'string' && j.classification.trim()) descBits.push(j.classification.trim());
    const min = typeof j.minSalary === 'string' ? j.minSalary.trim() : '';
    const max = typeof j.maxSalary === 'string' ? j.maxSalary.trim() : '';
    if (min || max) {
      const range = [min, max].filter(Boolean).join(' - ');
      const frame = typeof j.payTypeFrame === 'string' ? j.payTypeFrame.trim() : '';
      descBits.push([range, frame].filter(Boolean).join(' '));
    }

    const job = {
      title: String(j.title),
      url,
      company: companyName,
      location,
    };
    if (descBits.length) job.description = descBits.join(' · ');

    out.push(job);
  }
  return out;
}
