// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

/**
 * Indeed Publisher API provider.
 * Free quota requires an Indeed Publisher ID; keep it in INDEED_PUBLISHER_ID.
 * The legacy endpoint is retained behind an explicit provider so it never
 * activates until the user supplies credentials and enables the board.
 */
const DEFAULT_API = 'https://api.indeed.com/ads/apisearch';

/** @type {Provider} */
export default {
  id: 'indeed',

  detect(entry) {
    if (entry.provider !== 'indeed') return null;
    const api = typeof entry.api === 'string' && entry.api ? entry.api : DEFAULT_API;
    return { url: api };
  },

  async fetch(entry, ctx) {
    const publisher = process.env.INDEED_PUBLISHER_ID || '';
    if (!publisher) throw new Error('indeed: INDEED_PUBLISHER_ID is not configured');
    const cfg = entry.indeed && typeof entry.indeed === 'object' ? entry.indeed : {};
    const params = new URLSearchParams({
      publisher,
      q: String(cfg.query || 'AI Engineer OR Machine Learning OR LLM'),
      l: String(cfg.location || 'United States'),
      sort: 'date',
      radius: String(cfg.radius || 50),
      st: 'jobsite',
      jt: 'fulltime',
      limit: String(cfg.limit || 25),
      fromage: String(cfg.fromage || 3),
      format: 'json',
      v: '2',
    });
    const url = `${entry.api || DEFAULT_API}?${params}`;
    const json = await ctx.fetchJson(url, { timeoutMs: 30_000, redirect: 'error' });
    const results = Array.isArray(json?.results) ? json.results : [];
    return results.map(j => ({
      title: j.jobtitle || '',
      url: j.url || '',
      company: j.company || 'Indeed employer',
      location: j.formattedLocation || j.city || '',
      description: j.snippet || '',
      postedAt: j.date ? Date.parse(j.date) : undefined,
      salary: j.salary ? { raw: j.salary } : undefined,
    })).filter(j => j.title && j.url);
  },
};
