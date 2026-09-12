// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// joinup.ch provider — Swiss startup job platform (Typesense-backed Next.js).
//
// The browse page server-renders the newest page of results into __NEXT_DATA__
// at props.pageProps.serverState.initialResults.jobs.results[0].hits[]. The
// full board (~1000 jobs) lives behind a Typesense search key that is injected
// at runtime (not in the static bundle), so we read the SSR'd newest page —
// since results are created-DESC this reliably catches the latest postings,
// which is what a periodic scan needs. Most older joinup roles are also tracked
// directly via their company's ATS (Getro/Personio/Ashby/etc.).
//
// Each hit: { title|headline, startup (employer), slug, location, created }.
// Public posting URL: https://joinup.ch/job/{slug}
//
// Auto-detects from a careers_url whose host is joinup.ch.

// joinup.ch's __NEXT_DATA__ carries `created` as an ISO string, with numeric
// epochs seen on a few older records; both shapes are handled. Non-positive
// values are treated as missing rather than dating the posting to 1970.
function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Values below 1e12 are Unix seconds; at or above, already ms.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}

const BROWSE_URL = 'https://joinup.ch/browse/jobs';

/** @type {Provider} */
export default {
  id: 'joinup',

  detect(entry) {
    let host;
    try { host = new URL(entry.careers_url || '').hostname; } catch { return null; }
    return /(^|\.)joinup\.ch$/i.test(host) ? { url: BROWSE_URL } : null;
  },

  async fetch(entry, ctx) {
    // redirect:'error' — BROWSE_URL is pinned to joinup.ch (https); a 3xx must
    // not be followed to a private/metadata IP (matches every other provider).
    const html = await ctx.fetchText(BROWSE_URL, { redirect: 'error' });
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    // Fail closed: a missing/unparseable __NEXT_DATA__ is a scraper break, not an
    // empty board — throw so the scan logs it instead of silently reporting zero.
    if (!m) throw new Error(`joinup: ${entry.name} page is missing __NEXT_DATA__ (structure changed?)`);
    let hits = [];
    try {
      const data = JSON.parse(m[1]);
      const ir = data?.props?.pageProps?.serverState?.initialResults?.jobs?.results;
      hits = Array.isArray(ir) && ir[0]?.hits ? ir[0].hits : [];
    } catch (err) {
      throw new Error(`joinup: ${entry.name} failed to parse __NEXT_DATA__ — ${err.message}`);
    }
    return hits
      .filter(h => h && h.slug && (h.title || h.headline))
      .map(h => ({
        title: h.title || h.headline || '',
        url: `https://joinup.ch/job/${h.slug}`,
        company: h.startup || entry.name || '',
        location: typeof h.location === 'string' ? h.location
          : (h.location?.name || h.location?.city || ''),
        postedAt: toEpochMs(h.created),
      }));
  },
};
