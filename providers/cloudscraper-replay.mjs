// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Cloudscraper-replay provider — for boards behind Cloudflare/bot-protection
// that require a real browser session to capture a HAR or cookies.
//
// Workflow:
// 1. User captures a HAR (HTTP Archive) via Playwright once:
//    - Opens the board search page
//    - Exports HAR as JSON
// 2. User stores the HAR in data/har/<board-name>.har
// 3. This provider replays the HAR using Node's http.request (no browser needed)
//    for subsequent scans, extracting jobs from the replayed response.
//
// To add a new board:
//   - Create a HAR file in data/har/<board-name>.har
//   - Add entry in portals.yml with provider: cloudscraper-replay
//   - Configure har_file and parse_fn (optional, uses default HTML parser)
//
// If no HAR exists, falls back to plain HTTP (may be blocked).

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { decodeEntities } from './_html-entities.mjs';

/** @type {string} */
const DATA_HAR_DIR = 'data/har';

/**
 * Parse a HAR file and extract the first matching response body.
 * @param {string} harPath
 * @param {string} [targetUrl]
 * @returns {{ headers: object, body: string } | null}
 */
function loadHarResponse(harPath, targetUrl) {
  if (!existsSync(harPath)) return null;

  let har;
  try {
    har = JSON.parse(readFileSync(harPath, 'utf8'));
  } catch {
    return null;
  }

  const entries = har.log?.entries || [];
  for (const entry of entries) {
    const requestUrl = entry.request?.url || '';
    const responseUrl = entry.response?.redirectURL || requestUrl;

    // Match if target URL specified and matches, or if this is the search page
    if (targetUrl && !responseUrl.includes(targetUrl)) continue;

    const response = entry.response;
    if (!response) continue;

    let body = '';
    const content = response.content;
    if (content?.text) {
      body = content.text;
    } else if (content?.encoding && content?.data) {
      // Base64 encoded body
      body = Buffer.from(content.data, 'base64').toString('utf8');
    }

    if (body) {
      return {
        headers: response.headers?.reduce((acc, h) => {
          acc[h.name] = h.value;
          return acc;
        }, {}) || {},
        body,
      };
    }
  }

  return null;
}

/**
 * Parse HTML response for job postings.
 * Default parser for boards without custom HTML structure.
 * @param {string} html
 * @param {object} entry
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHtmlJobs(html, entry) {
  const jobs = [];
  const companyName = entry.name || 'Unknown';

  // Simple regex-based extraction (improve per board)
  const titlePattern = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  const seen = new Set();

  while ((match = titlePattern.exec(html)) !== null) {
    const url = match[1];
    const title = decodeEntities(match[2]).trim();

    if (title && !seen.has(title) && url.length > 10) {
      seen.add(title);
      jobs.push({ title, url, company: companyName, location: '' });
    }
  }

  return jobs.slice(0, 50); // cap to avoid flooding
}

/** @type {Provider} */
export default {
  id: 'cloudscraper-replay',

  detect(entry) {
    // Always explicit — this is a special-purpose replay provider
    return entry.provider === 'cloudscraper-replay' ? entry : null;
  },

  async fetch(entry, ctx) {
    const harFile = entry.har_file || entry.name?.toLowerCase().replace(/\s+/g, '-') + '.har';
    const harPath = path.join(getCareerOpsRoot(), DATA_HAR_DIR, harFile);

    // Load HAR replay
    const harData = loadHarResponse(harPath, entry.target_url);
    if (!harData) {
      // Fallback: try direct HTTP (will likely fail against Cloudflare)
      console.warn(`cloudscraper-replay: no HAR found for ${harFile}, attempting direct fetch`);
      try {
        const html = await ctx.fetchText(entry.careers_url, { redirect: 'error' });
        return parseHtmlJobs(html, entry);
      } catch (err) {
        console.warn(`cloudscraper-replay: direct fetch also failed: ${err.message}`);
        return [];
      }
    }

    // Use HAR response body as if it were a fresh fetch
    const html = harData.body;
    if (!html) return [];

    // Custom parser if specified
    if (entry.parse_fn) {
      try {
        // Dynamic require of custom parser function (for board-specific parsing)
        const parseModule = await import(path.join(getCareerOpsRoot(), entry.parse_fn));
        if (parseModule.default && typeof parseModule.default === 'function') {
          return parseModule.default(html, entry);
        }
      } catch {}
    }

    return parseHtmlJobs(html, entry);
  },
};
