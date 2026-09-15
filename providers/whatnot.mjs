// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Whatnot provider — Whatnot's careers board (jobs.whatnot.com, an Ashby custom
// domain) fronts a public, auth-free JSON feed of its own:
//   GET https://jobs.whatnot.com/api/jobs   ->   { results: [ ... ] }
// The standard Ashby posting-api is disabled for them, but this proxy works and
// returns the full board (~120 jobs) in one request. Each item has an absolute
// applyLink (jobs.ashbyhq.com/whatnot/<id>) and locationName/secondaryLocationNames.

const ALLOWED_HOST = 'jobs.whatnot.com';
const FEED_URL = 'https://jobs.whatnot.com/api/jobs';

/** @param {string} url */
function assertWhatnotUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`whatnot: invalid URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`whatnot: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST) throw new Error(`whatnot: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

function locationOf(j) {
  const all = [j.locationName, ...(Array.isArray(j.secondaryLocationNames) ? j.secondaryLocationNames : [])];
  return [...new Set(all.filter(Boolean))].join('; ');
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: 'whatnot',

  detect(entry) {
    const url = entry.careers_url || '';
    try {
      if (new URL(url).hostname === ALLOWED_HOST) return { url: FEED_URL };
    } catch {
      // not a URL — fall through
    }
    return null;
  },

  async fetch(entry, ctx) {
    assertWhatnotUrl(FEED_URL);
    const json = /** @type {any} */ (await ctx.fetchJson(FEED_URL, { redirect: 'error' }));
    const rows = Array.isArray(json?.results) ? json.results : (Array.isArray(json) ? json : []);
    return rows
      .filter(/** @param {any} j */ j => j.title && (j.applyLink || j.externalLink || j.jobId || j.id))
      .map(/** @param {any} j */ j => ({
        title: j.title,
        url: j.applyLink || j.externalLink || `https://jobs.whatnot.com/${j.jobId || j.id}`,
        company: entry.name,
        location: locationOf(j),
        postedAt: toEpochMs(j.updatedAt || j.publishedDate),
      }));
  },
};
