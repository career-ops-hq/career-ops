// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Atlassian provider — Atlassian runs a custom careers site (iCIMS-backed) but
// fronts it with a single public, auth-free JSON feed of every open posting:
//   GET https://www.atlassian.com/endpoint/careers/listings
// Each item carries title, category, a messy locations[] array, and an
// absolute applyUrl (iCIMS). One request returns the full board (~200 jobs),
// so there is no pagination to handle.
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

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
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
    const jobs = Array.isArray(json) ? json : [];
    return jobs
      .filter(/** @param {any} j */ j => (j.applyUrl || j.portalJobPost?.portalUrl) && j.title)
      .map(/** @param {any} j */ j => ({
        title: j.title || '',
        url: j.applyUrl || j.portalJobPost?.portalUrl,
        company: entry.name,
        location: formatLocation(j),
        postedAt: toEpochMs(j.portalJobPost?.updatedDate),
      }));
  },
};
