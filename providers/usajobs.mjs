// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

/**
 * USAJOBS public API provider.
 * Free API key required; keep it in USAJOBS_API_KEY, never in portals.yml.
 * https://developer.usajobs.gov/
 */
const DEFAULT_API = 'https://data.usajobs.gov/api/search';

/** @type {Provider} */
export default {
  id: 'usajobs',

  detect(entry) {
    if (entry.provider !== 'usajobs') return null;
    return { url: entry.api || DEFAULT_API };
  },

  async fetch(entry, ctx) {
    const key = process.env.USAJOBS_API_KEY || '';
    if (!key) throw new Error('usajobs: USAJOBS_API_KEY is not configured');
    const cfg = entry.usajobs && typeof entry.usajobs === 'object' ? entry.usajobs : {};
    const url = entry.api || DEFAULT_API;
    const json = await ctx.fetchJson(url, {
      timeoutMs: 30_000,
      headers: {
        Host: 'data.usajobs.gov',
        'User-Agent': 'career-ops/1.0 (job-search automation; https://github.com/santifer/career-ops)',
        'Authorization-Key': key,
      },
      redirect: 'error',
    });
    const items = Array.isArray(json?.SearchResult?.SearchResultItems)
      ? json.SearchResult.SearchResultItems : [];
    return items.map((item) => {
      const d = item?.MatchedObjectDescriptor || {};
      const locations = Array.isArray(d.PositionLocation)
        ? d.PositionLocation.map(x => x?.LocationName || '').filter(Boolean).join(' · ')
        : '';
      return {
        title: d.PositionTitle || '',
        url: Array.isArray(d.ApplyURI) ? d.ApplyURI[0] || '' : '',
        company: d.OrganizationName || 'US Government',
        location: d.PositionLocationDisplay || locations,
        description: d.UserArea?.Details?.JobSummary || d.QualificationSummary || '',
        postedAt: d.PublicationStartDate ? Date.parse(d.PublicationStartDate) : undefined,
        salary: d.PositionRemuneration?.[0] ? {
          min: Number(d.PositionRemuneration[0].MinimumRange) || undefined,
          max: Number(d.PositionRemuneration[0].MaximumRange) || undefined,
          currency: 'USD',
        } : undefined,
      };
    }).filter(j => j.title && j.url);
  },
};
