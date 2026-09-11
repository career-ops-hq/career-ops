// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Totaljobs provider — UK job board (Centrica/StepTwo group)
// URL: https://www.totaljobs.com/jobs
//
// Uses Playwright one-shot HAR capture, then replays through this provider.
// The site uses Cloudflare bot protection on search pages.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Totaljobs search results page.
 * @param {string} html
 * @param {object} [entry]
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseTotaljobsPage(html, entry) {
  const jobs = [];
  const seen = new Set();
  const companyName = entry?.name || 'Totaljobs';

  // Totaljobs uses article cards with job-title links
  const cardPattern = /<article[^>]*class="[^"]*job[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = cardPattern.exec(html)) !== null) {
    const cardHtml = match[1];
    const titleLinkMatch = cardHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*job-title[^"]*"[^>]*>([^<]+)<\/a>/i)
      || cardHtml.match(/<h3[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);

    if (!titleLinkMatch) continue;

    let url = titleLinkMatch[1];
    const title = clean(titleLinkMatch[2]);
    if (!title || seen.has(title)) continue;
    if (url.startsWith('/')) {
      url = 'https://www.totaljobs.com' + url;
    }

    const companyMatch = cardHtml.match(/<span[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)/i)
      || cardHtml.match(/<[^>]*>([^<,]+),\s*(.+?)\s*<\/[^>]*>/i);
    const company = companyMatch ? clean(companyMatch[1]) : companyName;

    const locationMatch = cardHtml.match(/location[^<]*<[^>]*>([^,]+)/i);
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({ title, url, company, location });
  }

  // Fallback: simple anchor pattern
  if (jobs.length === 0) {
    const linkPattern = /<a[^>]+href="(\/jobs\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = linkPattern.exec(html)) !== null) {
      const url = 'https://www.totaljobs.com' + match[1];
      const title = clean(match[2]);
      if (title && !seen.has(title) && title.length > 10) {
        seen.add(title);
        jobs.push({ title, url, company: companyName, location: '' });
      }
    }
  }

  return jobs.slice(0, 30);
}

/** @type {Provider} */
export default {
  id: 'totaljobs',

  detect(entry) {
    return entry.careers_url?.includes('totaljobs.com') ? entry : null;
  },

  async fetch(entry, ctx) {
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    if (keywords.length === 0) {
      console.warn('totaljobs: no keywords provided');
      return [];
    }

    const harFile = entry.har_file || 'totaljobs.har';
    const harPath = path.join(getCareerOpsRoot(), 'data/har', harFile);

    // Check for HAR replay first
    if (existsSync(harPath)) {
      const har = JSON.parse(readFileSync(harPath, 'utf8'));
      const entries = har.log?.entries || [];

      for (const e of entries) {
        const url = e.request?.url || '';
        if (url.includes('totaljobs.com') && e.response?.content?.text) {
          // Use HAR response as the source
          const html = e.response.content.text;
          return parseTotaljobsPage(html, entry);
        }
      }
    }

    // Fallback: try direct HTTP (may be blocked by Cloudflare)
    console.warn('totaljobs: no HAR file found, attempting direct fetch (may fail)');

    // All keywords fetched in parallel; single-page boards, no pagination.
    const perKeyword = await Promise.all(keywords.map(async (kw) => {
      const location = encodeURIComponent(entry.location || 'london');
      const query = encodeURIComponent(kw);
      const url = `https://www.totaljobs.com/jobs/${query}-jobs-in-${location}`;

      try {
        const html = await ctx.fetchText(url, {
          headers: { 'user-agent': BROWSER_LIKE_USER_AGENT },
          redirect: 'follow',
        });
        return parseTotaljobsPage(html, entry);
      } catch (err) {
        console.warn(`totaljobs: failed for "${kw}": ${err.message}`);
        return [];
      }
    }));

    return perKeyword.flat();
  },
};