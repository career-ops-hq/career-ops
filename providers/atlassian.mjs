// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { coerceId } from './_ids.mjs';

// Atlassian provider — Atlassian runs a custom careers site (iCIMS-backed) but
// fronts it with a single public, auth-free JSON feed of every open posting:
//   GET https://www.atlassian.com/endpoint/careers/listings
// Each item carries title, category, a messy locations[] array, and two iCIMS
// URLs: portalJobPost.portalUrl, the posting page (".../job"), and applyUrl,
// the application form (".../job?mode=apply"). The posting page is the one the
// row keeps — it is what a liveness check or a JD fetch needs to read — with
// applyUrl as the fallback. One request returns the full board (~290 jobs on
// 2026-09-24), so there is no pagination to handle.
//
// Wire up with `provider: atlassian` in portals.yml (careers_url is only used
// for the human-facing link). detect() also claims any www.atlassian.com
// careers URL so auto-detection works without the explicit field.

const LISTINGS_URL = 'https://www.atlassian.com/endpoint/careers/listings';
const ALLOWED_HOST = 'www.atlassian.com';

/** @param {string} url */
function assertAtlassianUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`atlassian: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`atlassian: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST)
    throw new Error(`atlassian: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

// Collapse the feed's whitespace-heavy location strings (e.g.
// "San Francisco - United States -   San Francisco, California 94104 United States")
// into a single line, joining multi-location postings with "; " so the
// scanner's substring location filter still matches city/country tokens.
/** @param {any} job */
function formatLocation(job) {
  const locs = Array.isArray(job.locations) ? job.locations : [];
  return locs.map(l => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ');
}

/** @type {Provider} */
export default {
  id: 'atlassian',

  detect(entry) {
    const url = entry.careers_url || '';
    try {
      const parsed = new URL(url);
      if (parsed.hostname === ALLOWED_HOST && /careers/i.test(parsed.pathname)) {
        return { url: LISTINGS_URL };
      }
    } catch {
      // not a URL — fall through
    }
    return null;
  },

  async fetch(entry, ctx) {
    assertAtlassianUrl(LISTINGS_URL);
    // redirect:'error' blocks SSRF via server-side redirects; with the host
    // assertion above the final host is guaranteed to stay www.atlassian.com.
    const json = /** @type {any} */ (await ctx.fetchJson(LISTINGS_URL, { redirect: 'error' }));
    // The feed is a bare array. Anything else means Atlassian changed the
    // endpoint's shape, and returning [] would read as "no open roles" forever —
    // name what arrived instead (the parseIbmResponse precedent in ibm.mjs).
    if (!Array.isArray(json)) {
      const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 8).join(', ') : typeof json;
      throw new Error(`atlassian: ${LISTINGS_URL} did not return an array of listings — got ${keys}`);
    }
    const jobs = json;
    return jobs
      .filter(/** @param {any} j */ j => (j.portalJobPost?.portalUrl || j.applyUrl) && j.title)
      .map(/** @param {any} j */ j => ({
        title: j.title || '',
        url: j.portalJobPost?.portalUrl || j.applyUrl,
        company: entry.name,
        location: formatLocation(j),
        // No postedAt. The feed's only date is portalJobPost.updatedDate, which
        // is when the posting was last EDITED — Job.postedAt is the publication
        // date (schema.org datePosted), and scan.mjs's max-age filter treats it
        // as one, so an old role edited yesterday would read as new. The value is
        // also a zone-less "2026-09-11 01:00 AM", which Date.parse reads in local
        // time (a 16h spread between UTC and Asia/Tokyo). An absent date means
        // "unknown", never "stale" — same call as successfactors.mjs.
        ...(coerceId(j.id) ? { externalId: /** @type {string} */ (coerceId(j.id)) } : {}),
      }));
  },
};
