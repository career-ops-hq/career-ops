// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Indeed UK provider
// Public API requires authentication; scraping unprotected pages works with care.
// This provider uses the public Indeed job search page structure.
//
// Note: Indeed actively fights scraping. Use cautiously and respect robots.txt.
// URL: https://uk.indeed.com/jobs?q=<keyword>&l=<location>
//
// Alternative: use Indeed's official API (requires account).

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const INDEED_BASE = 'https://uk.indeed.com';

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Indeed search results.
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseIndeedPage(html, companyName) {
  const jobs = [];
  // Indeed uses <h2> tags with job titles, <a> with /sv/ redirect links
  const titlePattern = /<h2[^>]*><a[^>]+href="([^"]+)"/gi;
  let match;
  const seen = new Set();

  while ((match = titlePattern.exec(html)) !== null) {
    const redirectUrl = match[1];
    const titleMatch = html.substring(match.index, match.index + 500).match(/<a[^>]+href="[^"]+"[^>]*>([^<]+)<\/a>/);
    const title = titleMatch ? clean(titleMatch[1]) : '';

    if (!title || seen.has(title)) continue;

    // Indeed redirect URLs contain the actual job URL encoded
    const decodedUrl = redirectUrl.includes('url=') ? decodeURIComponent(redirectUrl.split('url=')[1].split('&')[0]) : redirectUrl;

    // Extract company and location from adjacent markup
    const context = html.substring(Math.max(0, match.index - 300), match.index + 200);
    const companyMatch = context.match(/<span[^>]*class="companyName"[^>]*>([^<]+)<\/span>/i);
    const locationMatch = context.match(/<span[^>]*class="companyLocation"[^>]*>([^<]+)<\/span>/i);

    const company = companyMatch ? clean(companyMatch[1]) : companyName;
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({ title, url: decodedUrl, company, location });
  }

  return jobs.slice(0, 30);
}

/** @type {Provider} */
export default {
  id: 'indeed',

  detect(entry) {
    if (!entry.careers_url) return null;
    return entry.careers_url.includes('indeed.com') ? entry : null;
  },

  async fetch(entry, ctx) {
    /** @type {string[]} */
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    if (keywords.length === 0) return [];

    const maxPages = Math.min(Number(entry.max_pages) || 2, 5);
    const location = entry.location || 'london';

    // One keyword per async lane; pages within a keyword stay sequential so
    // the short-page early break still saves the requests it always did.
    const perKeyword = await Promise.all(keywords.map(async (kw) => {
      const jobs = [];
      for (let page = 0; page < maxPages; page++) {
        const url = `${INDEED_BASE}/jobs?q=${encodeURIComponent(kw)}&l=${encodeURIComponent(location)}&start=${page * 15}`;

        try {
          const html = await ctx.fetchText(url, {
            headers: { 'user-agent': BROWSER_LIKE_USER_AGENT },
            redirect: 'error',
          });

          const pageJobs = parseIndeedPage(html, entry.name || 'Indeed');
          jobs.push(...pageJobs);
          if (pageJobs.length < 15) break;
        } catch (err) {
          console.warn(`indeed: failed for "${kw}" page ${page}: ${err.message}`);
          break;
        }
      }
      return jobs;
    }));

    return perKeyword.flat();
  },
};
