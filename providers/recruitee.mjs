// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Recruitee provider — hits the public per-tenant offers API.
// Auto-detects from careers_url pattern `https://<slug>.recruitee.com`.
// Per-tenant subdomains are the variable part — SSRF defence uses a
// regex match on `<safe-slug>.recruitee.com` rather than a static
// allowlist.

import { htmlToText } from './_html-to-text.mjs';

const RECRUITEE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;

function assertRecruiteeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`recruitee: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`recruitee: URL must use HTTPS: ${url}`);
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`recruitee: untrusted hostname "${parsed.hostname}" — must match <slug>.recruitee.com`);
  }
  return url;
}

function resolveApiUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/api/offers/`;
}

/** @type {Provider} */
export default {
  id: 'recruitee',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`recruitee: cannot derive API URL for ${entry.name}`);
    assertRecruiteeUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseRecruiteeResponse(json, entry.name);
  },
};

// Recruitee serves a shared demo/trial-account posting for tenants that
// never launched real hiring — the API still answers 200 with well-formed
// job data (#4190). Verified live against 2 unrelated tenants (adecco,
// accenture): both return the identical title "Senior Marketer (Sample)"
// with the identical description text, byte-for-byte. Recruitee itself
// stamps the "(Sample)" marker on the title, so this is the platform's own
// label for seeded content, not a heuristic guess — a real employer would
// not title a real opening "(Sample)". Known gap, left uncaught: a demo
// tenant can carry OTHER leftover postings with no "(Sample)" tag (observed:
// personio's "API Job - Berlin - Musterstr 1, 10111", accenture's generic
// "sales executive") — those have no reliable platform-provided marker and
// are not addressed here.
const RECRUITEE_SAMPLE_TITLE_RE = /\(sample\)/i;

function isRecruiteeSamplePosting(j) {
  const title = typeof j?.title === 'string' ? j.title : '';
  return RECRUITEE_SAMPLE_TITLE_RE.test(title);
}

/**
 * Assemble a location string for one offer.
 *
 * Recruitee's flat `location` field carries only the offer's PRIMARY place
 * even when the offer is open in more than one: a live posting was observed
 * with `location: "Zürich, Zürich, Switzerland"` while its `locations`
 * array also carried a `"remote in Germany"` entry — so a `location_filter`
 * scoped to Germany never saw that the role was open there at all. `locations`
 * holds every place as `{ name, city, country, ... }`; when it lists 2+
 * DISTINCT names, those are joined instead of trusting the flat field —
 * counted after dedup, so an array that repeats the same place twice (e.g.
 * `[{name: "Berlin, Germany"}, {name: "Berlin, Germany"}]`) still falls
 * through to the flat-field path below rather than discarding a possibly
 * richer flat `location` string in favor of a "join" of one place. Each name
 * gets its `city` and `country` appended when present and not already part of
 * the name text (case-insensitive substring check per field, so "Zürich,
 * Switzerland" + city "Zürich" + country "Switzerland" does not become
 * "Zürich, Switzerland, Zürich, Switzerland" — each field is checked and
 * appended independently, so a name missing only one of the two still gets
 * exactly that one added). Deduped,
 * joined with " · " like ashby/eightfold/gem/workday's multi-place handling,
 * so scan.mjs's location_filter sees every place a multi-location role is
 * open to.
 *
 * Falls back to the pre-existing single-place logic — explicit `location`,
 * else assembled from city/country, appending "Remote" when `remote` is true
 * — when `locations` yields 0 or 1 distinct names.
 *
 * The joined multi-place path also honors the top-level `remote` flag: it is
 * a separate signal from the named places (a "remote in Germany" entry names
 * a place AND implies remote, but "Berlin, Germany" + "Paris, France" with
 * `remote: true` implies a fully-remote role without either name saying so).
 * "Remote" is appended unless a distinct name already expresses it
 * (case-insensitive substring), so it is never duplicated.
 *
 * @param {any} j
 * @returns {string}
 */
function assembleLocation(j) {
  const names = Array.isArray(j.locations)
    ? j.locations.map(l => {
        const name = typeof l?.name === 'string' ? l.name.trim() : '';
        if (!name) return '';
        const lowerName = name.toLowerCase();
        const parts = [name];
        const city = typeof l?.city === 'string' ? l.city.trim() : '';
        if (city && !lowerName.includes(city.toLowerCase())) parts.push(city);
        const country = typeof l?.country === 'string' ? l.country.trim() : '';
        if (country && !lowerName.includes(country.toLowerCase())) parts.push(country);
        return parts.join(', ');
      }).filter(Boolean)
    : [];
  const distinctNames = [...new Set(names)];
  if (distinctNames.length > 1) {
    const hasRemote = distinctNames.some(n => n.toLowerCase().includes('remote'));
    return j.remote && !hasRemote ? [...distinctNames, 'Remote'].join(' · ') : distinctNames.join(' · ');
  }
  const city = j.city || '';
  const country = j.country || '';
  const remote = j.remote ? 'Remote' : '';
  return j.location || [city, country, remote].filter(Boolean).join(', ');
}

/**
 * Parse a Recruitee /api/offers/ response. Exported for unit tests.
 *
 * Recruitee returns:
 *   { offers: [{ title, careers_url?, url?, city?, country?, remote?, location?, locations? }] }
 *
 * - url: tries `careers_url` first, falling back to `url` when `careers_url`
 *   is absent or invalid — each candidate validated independently, so one bad
 *   field never shadows an otherwise-usable other one. Recruitee tenants
 *   commonly serve postings on their own custom domain (e.g.
 *   `careers.hostaway.com`), so this URL is NOT host-locked to
 *   `*.recruitee.com`. Unlike the API endpoint, the per-offer URL is
 *   display-only — it is written to the pipeline and scan history but never
 *   server-fetched here, so the SSRF rationale does not apply. It is sourced
 *   from the already-validated tenant API response. Requirement: a
 *   well-formed `https:` URL; when neither candidate resolves, the whole
 *   offer is dropped (see Drop rule below).
 * - location: see `assembleLocation` — joins `locations[]` when it lists 2+
 *   distinct places (appending "Remote" when `remote` is true and no place
 *   name already says so), else the explicit `location` field, else assembled
 *   from city/country, appending "Remote" when `remote` is true.
 * - description: Recruitee's list payload embeds each offer's full HTML body
 *   for free (same request — verified against a live board), so it is
 *   stripped to plain text here and feeds scan.mjs's content_filter /
 *   visa_filter. Omitted when the offer carries no usable body.
 * - a posting Recruitee itself marks "(Sample)" in the title is dropped
 *   entirely (see isRecruiteeSamplePosting, #4190), so a tenant serving only
 *   its seeded sample posting resolves as empty rather than as a live board.
 *
 * Drop rule: an offer with no usable `title`, or no resolvable absolute
 * `url`, is silently omitted, never emitted half-formed with `title: ''` or
 * `url: ''` — same convention as `parseIbmResponse` (`providers/ibm.mjs`) and
 * `parseEightfoldResponse` (`providers/eightfold.mjs`). The URL requirement
 * is load-bearing beyond the general "required field" convention: `url` is
 * this provider's own dedup key downstream (`scan.mjs`'s `normalizeUrlForDedup`
 * treats an empty string as a value like any other), so a second title-bearing,
 * URL-less offer from the same tenant would silently collapse onto the first
 * one in `seenUrls` and be dropped as a false duplicate — worse than omitting
 * both up front. A malformed entry (`null`, a primitive, anything that isn't a
 * plain object) is skipped the same way, rather than throwing and losing
 * every other offer in the response.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string}>}
 */
export function parseRecruiteeResponse(json, companyName) {
  const offers = json?.offers;
  if (!Array.isArray(offers)) return [];
  const out = [];
  for (const j of offers) {
    if (!j || typeof j !== 'object') continue;
    if (isRecruiteeSamplePosting(j)) continue;
    const title = typeof j.title === 'string' ? j.title.trim() : '';
    if (!title) continue;

    // Resolve offer URL. Recruitee tenants commonly publish postings on their
    // own custom domain (e.g. careers.hostaway.com), so the per-offer URL is
    // NOT host-locked to *.recruitee.com — it is display-only (recorded in the
    // pipeline/history, never server-fetched here) and comes from the already-
    // validated tenant API response. Require a well-formed https: URL. Tries
    // `careers_url` first (preferred), falling back to `url` when
    // `careers_url` is absent, non-https, or malformed — each candidate is
    // validated independently, so one bad field doesn't drop an otherwise-
    // usable offer whose other field resolves fine. Only when NEITHER
    // candidate resolves is the offer dropped.
    let url = '';
    for (const candidate of [j.careers_url, j.url]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:') {
          url = parsed.href;
          break;
        }
      } catch {
        // malformed URL → try the next candidate
      }
    }
    if (!url) continue;

    const location = assembleLocation(j);
    const description = htmlToText(j.description);

    out.push({
      title,
      url,
      location,
      company: companyName,
      ...(description ? { description } : {}),
    });
  }
  return out;
}
