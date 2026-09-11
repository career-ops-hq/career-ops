// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Reed provider — UK's largest job board (AXA group)
// Public API available: https://www.reed.co.uk/api/ (requires key)
// Free tier: limited requests/day, no key needed for basic scraping.
//
// This provider scrapes the public listing pages directly.
// URLs: https://www.reed.co.uk/jobs/<keyword>-jobs-in-<location>
//
// HTML structure: each job card contains title link, company, location.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const REED_BASE = 'https://www.reed.co.uk';
const PER_PAGE = 50;

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Reed search results page for job listings.
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseReedSearchPage(html, companyName) {
  const jobs = [];
  // Reed uses job-card elements with href to job details
  const cardPattern = /<a[^>]+class="job-title"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = cardPattern.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = clean(match[2]);
    if (!title || seen.has(title)) continue;

    let url = rawUrl;
    if (rawUrl.startsWith('/')) url = REED_BASE + rawUrl;

    // Extract company and location from adjacent elements
    const cardBlock = html.substring(Math.max(0, match.index - 200), match.index + rawUrl.length + match[2].length + 200);
    const companyMatch = cardBlock.match(/<span[^>]*class="company-name"[^>]*>([^<]+)<\/span>/i);
    const locationMatch = cardBlock.match(/<span[^>]*class="job-location"[^>]*>([^<]+)<\/span>/i);

    const company = companyMatch ? clean(companyMatch[1]) : companyName;
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({ title, url, company, location });
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'reed',

  detect(entry) {
    if (!entry.careers_url) return null;
    return entry.careers_url.includes('reed.co.uk') ? entry : null;
  },

  async fetch(entry, ctx) {
    /** @type {string[]} */
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    if (keywords.length === 0) {
      console.warn('reed: no keywords provided');
      return [];
    }

    const maxPages = Math.min(Number(entry.max_pages) || 3, 10);
    const location = entry.location || 'london';
    const encodedLoc = encodeURIComponent(location);

    // One keyword per async lane; pages within a keyword stay sequential so
    // the short-page early break still saves the requests it always did.
    const perKeyword = await Promise.all(keywords.map(async (kw) => {
      const jobs = [];
      const encodedKw = encodeURIComponent(kw);
      for (let page = 1; page <= maxPages; page++) {
        const url = `${REED_BASE}/jobs/${encodedKw}-jobs-in-${encodedLoc}?page=${page}`;
        try {
          const html = await ctx.fetchText(url, {
            headers: { 'user-agent': BROWSER_LIKE_USER_AGENT },
            redirect: 'error',
          });
          const pageJobs = parseReedSearchPage(html, entry.name || 'Reed');
          jobs.push(...pageJobs);
          if (pageJobs.length < PER_PAGE) break; // last page
        } catch (err) {
          console.warn(`reed: failed for "${kw}" page ${page}: ${err.message}`);
          break;
        }
      }
      return jobs;
    }));

    return out.concat(...perKeyword);
  },
};
