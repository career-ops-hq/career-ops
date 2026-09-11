// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobsite provider — UK job board (Centrica/StepTwo group, sister to Totaljobs)
// URL: https://www.jobsite.co.uk/jobs
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
 * Parse Jobsite search results page.
 * @param {string} html
 * @param {object} [entry]
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJobsitePage(html, entry) {
  const jobs = [];
  const seen = new Set();
  const companyName = entry?.name || 'Jobsite';

  // Jobsite uses similar structure to Totaljobs
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
      url = 'https://www.jobsite.co.uk' + url;
    }

    const companyMatch = cardHtml.match(/<span[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)/i);
    const company = companyMatch ? clean(companyMatch[1]) : companyName;

    const locationMatch = cardHtml.match(/location[^<]*<[^>]*>([^,]+)/i);
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({ title, url, company, location });
  }

  if (jobs.length === 0) {
    const linkPattern = /<a[^>]+href="(\/jobs\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = linkPattern.exec(html)) !== null) {
      const url = 'https://www.jobsite.co.uk' + match[1];
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
  id: 'jobsite',

  detect(entry) {
    return entry.careers_url?.includes('jobsite.co.uk') ? entry : null;
  },

  async fetch(entry, ctx) {
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    if (keywords.length === 0) {
      console.warn('jobsite: no keywords provided');
      return [];
    }

    const harFile = entry.har_file || 'jobsite.har';
    const harPath = path.join(getCareerOpsRoot(), 'data/har', harFile);

    if (existsSync(harPath)) {
      const har = JSON.parse(readFileSync(harPath, 'utf8'));
      const entries = har.log?.entries || [];

      for (const e of entries) {
        const url = e.request?.url || '';
        if (url.includes('jobsite.co.uk') && e.response?.content?.text) {
          const html = e.response.content.text;
          return parseJobsitePage(html, entry);
        }
      }
    }

    console.warn('jobsite: no HAR file found, attempting direct fetch (may fail)');

    // All keywords fetched in parallel; single-page boards, no pagination.
    const perKeyword = await Promise.all(keywords.map(async (kw) => {
      const location = encodeURIComponent(entry.location || 'london');
      const query = encodeURIComponent(kw);
      const url = `https://www.jobsite.co.uk/jobs/${query}-jobs-in-${location}`;

      try {
        const html = await ctx.fetchText(url, {
          headers: { 'user-agent': BROWSER_LIKE_USER_AGENT },
          redirect: 'follow',
        });
        return parseJobsitePage(html, entry);
      } catch (err) {
        console.warn(`jobsite: failed for "${kw}": ${err.message}`);
        return [];
      }
    }));

    return perKeyword.flat();
  },
};