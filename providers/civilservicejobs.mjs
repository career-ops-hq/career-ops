// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Civil Service Jobs provider — UK government jobs portal
// URL: https://www.civilservicejobs.service.gov.uk/csr/index.cgi
//
// Uses Playwright one-shot to capture search results as HAR, then replays.
// The search form is POST-based and requires a session cookie, so direct
// HTTP fetch will not work without a browser session.
//
// Workflow:
//   1. Capture HAR via scripts/har-capture.mjs (Playwright)
//   2. Store HAR in data/har/civilservicejobs.har
//   3. This provider replays it for subsequent scans

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCareerOpsRoot } from '../path-resolver.mjs';

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Civil Service Jobs listing HTML.
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseCivilServicePage(html) {
  const jobs = [];
  const seen = new Set();

  // Civil Service Jobs uses table rows for listings
  // Each job has a title link and details in adjacent cells
  const rowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  let match;

  while ((match = rowPattern.exec(html)) !== null) {
    const rowHtml = match[1];
    const titleLinkMatch = rowHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!titleLinkMatch) continue;

    let url = titleLinkMatch[1];
    const title = clean(titleLinkMatch[2]);
    if (!title || seen.has(title)) continue;

    // Make URL absolute
    if (url.startsWith('/')) {
      url = 'https://www.civilservicejobs.service.gov.uk' + url;
    }

    // Extract location and other details
    const locationMatch = rowHtml.match(/<td[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)<\/td>/i);
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(title);
    jobs.push({
      title,
      url,
      company: 'UK Civil Service',
      location,
    });
  }

  return jobs.slice(0, 30);
}

/** @type {Provider} */
export default {
  id: 'civilservicejobs',

  detect(entry) {
    return entry.careers_url?.includes('civilservicejobs.service.gov.uk') ? entry : null;
  },

  async fetch(entry, ctx) {
    const harFile = entry.har_file || 'civilservicejobs.har';
    const harPath = path.join(getCareerOpsRoot(), 'data/har', harFile);

    if (existsSync(harPath)) {
      const har = JSON.parse(readFileSync(harPath, 'utf8'));
      const entries = har.log?.entries || [];

      // Find the search results response
      for (const e of entries) {
        const url = e.request?.url || '';
        if (url.includes('civilservicejobs') && e.response?.content?.text) {
          const html = e.response.content.text;
          return parseCivilServicePage(html, entry);
        }
      }
    }

    // Fallback: warn that manual capture is needed
    console.warn('civilservicejobs: no HAR file found. Capture one via scripts/har-capture.mjs');
    return [];
  },
};