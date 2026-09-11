// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Find a Job UK (DWP) provider — UK government job board
// URL: https://findajob.dwp.gov.uk/
//
// Uses Playwright one-shot to capture search results as HAR, then replays.
// The search is POST-based with CSRF tokens, requiring a browser session.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCareerOpsRoot } from '../path-resolver.mjs';

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Find a Job search results page.
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseFindAJobPage(html) {
  const jobs = [];
  const seen = new Set();

  // Find a Job usesgovuk-style card layouts
  // Job cards typically have a title link within an h3
  const cardPattern = /<div[^>]*class="govuk-grid-column[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = cardPattern.exec(html)) !== null) {
    const cardHtml = match[1];
    const titleMatch = cardHtml.match(/<h3[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    const title = clean(titleMatch[2]);
    if (!title || seen.has(title)) continue;
    if (url.startsWith('/')) {
      url = 'https://findajob.dwp.gov.uk' + url;
    }

    // Extract company and location
    const companyMatch = cardHtml.match(/company[^<]*<[^>]*>([^<]+)/i);
    const company = companyMatch ? clean(companyMatch[1]) : 'Unknown Employer';

    const locationMatch = cardHtml.match(/location[^<]*<[^>]*>([^<,]+)/i);
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({ title, url, company, location });
  }

  return jobs.slice(0, 30);
}

/** @type {Provider} */
export default {
  id: 'findajob',

  detect(entry) {
    return entry.careers_url?.includes('findajob.dwp.gov.uk') ? entry : null;
  },

  async fetch(entry, ctx) {
    const harFile = entry.har_file || 'findajob.har';
    const harPath = path.join(getCareerOpsRoot(), 'data/har', harFile);

    if (existsSync(harPath)) {
      const har = JSON.parse(readFileSync(harPath, 'utf8'));
      const entries = har.log?.entries || [];

      for (const e of entries) {
        const url = e.request?.url || '';
        if (url.includes('findajob.dwp.gov.uk') && e.response?.content?.text) {
          const html = e.response.content.text;
          return parseFindAJobPage(html, entry);
        }
      }
    }

    console.warn('findajob: no HAR file found. Capture one via scripts/har-capture.mjs');
    return [];
  },
};