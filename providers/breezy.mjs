// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Breezy HR provider — hits the public per-tenant board feed.
// Auto-detects from careers_url pattern `https://<tenant>.breezy.hr[/...]`.
// Per-tenant subdomains are the variable part, so SSRF defence uses a regex
// match on `<safe-tenant>.breezy.hr` rather than a static allowlist (same
// approach as the recruitee / bamboohr providers).
//
// Breezy boards expose every published position as a public JSON array at
// `<tenant>.breezy.hr/json` — title, absolute url, location, and a published
// date, all in the list payload at zero token cost (no per-job request, so the
// scanner stays zero-token). Breezy's authenticated REST API (api.breezy.hr) is
// intentionally NOT used; only the public board feed.

const BREEZY_HOST_RE = /^[a-z0-9][a-z0-9-]*\.breezy\.hr$/;

/** @param {string} url */
function assertBreezyUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`breezy: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`breezy: URL must use HTTPS: ${url}`);
  if (!BREEZY_HOST_RE.test(parsed.hostname)) {
    throw new Error(`breezy: untrusted hostname "${parsed.hostname}" — must match <tenant>.breezy.hr`);
  }
  return url;
}

/**
 * Resolve the tenant origin (`https://<tenant>.breezy.hr`) from an entry.
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
  if (!BREEZY_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}`;
}

/** @type {Provider} */
export default {
  id: 'breezy',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/json` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`breezy: cannot derive API URL for ${entry.name}`);
    const apiUrl = `${origin}/json`;
    assertBreezyUrl(apiUrl);
    // redirect:'error' + the host check above keep the final hostname pinned to
    // the tenant — a server-side redirect can't bounce us off-domain (SSRF).
    const json = /** @type {any} */ (await ctx.fetchJson(apiUrl, { redirect: 'error' }));
    return parseBreezyResponse(json, entry.name);
  },
};

/**
 * Parse a Breezy `<tenant>.breezy.hr/json` response. Exported for unit tests.
 *
 * Breezy returns a top-level array of positions:
 *   [{ name, url, published_date?,
 *      location: { name?, city?, state?, country?: { name }, is_remote? } }]
 *
 * - url: Breezy supplies an absolute posting URL on the tenant domain
 *   (`https://<tenant>.breezy.hr/p/<id>-<slug>`); it is the Job contract's dedup
 *   key. The per-offer URL is display-only (recorded in the pipeline/history,
 *   never server-fetched here), so it is not host-locked — only a well-formed
 *   `https:` URL is required; rows without one are dropped.
 * - location: prefer the ready-made `location.name`; else assemble from
 *   city / state / country.name, appending "Remote" when `is_remote` is truthy.
 * - postedAt: parsed from the ISO `published_date` when present and valid — Breezy
 *   gives it for free in the list payload, so recency consumers can use it.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseBreezyResponse(json, companyName) {
  const rows = Array.isArray(json) ? json : [];
  const out = [];
  for (const j of rows) {
    if (!j || !j.name) continue;

    // Resolve the posting URL (dedup key). Require a well-formed https: URL;
    // a non-https or malformed/missing URL drops the row.
    let url = '';
    const rawUrl = typeof j.url === 'string' ? j.url : '';
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:') url = parsed.href;
      } catch { /* malformed → drop */ }
    }
    if (!url) continue;

    const loc = j.location || {};
    const remote = loc.is_remote ? 'Remote' : '';
    const assembled = [loc.city, loc.state, loc.country?.name].filter(Boolean).join(', ');
    const base = (typeof loc.name === 'string' && loc.name.trim()) ? loc.name.trim() : assembled;
    const location = remote && !/remote/i.test(base)
      ? [base, remote].filter(Boolean).join(', ')
      : base;

    const job = {
      title: String(j.name),
      url,
      company: companyName,
      location,
    };

    const ts = Date.parse(j.published_date);
    if (!Number.isNaN(ts)) job.postedAt = ts;

    out.push(job);
  }
  return out;
}
