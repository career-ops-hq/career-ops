// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// iCIMS provider — scrapes the public hosted-portal search pages.
// Auto-detects from careers_url on any `*.icims.com` https host
// (canonical form: `https://careers-<tenant>.icims.com/jobs/search?ss=1`).
//
// iCIMS list pages carry title/location/URL but NO posted date; dates live
// only on the job detail page's JSON-LD (schema.org JobPosting `datePosted`).
// The provider therefore returns undated jobs plus an `enrichDate(job, ctx)`
// hook — scan-ats-full.mjs calls it only for jobs that already passed the
// cheap title/location filters, so a 10k-tenant sweep pays detail-page
// requests for real candidates only, never for noise.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

// ~20 postings/page → 30 pages covers 600 postings; tenants bigger than that
// are rare on iCIMS and a reverse scan only needs the fresh slice anyway.
const ICIMS_MAX_PAGES = 30;
// Same per-tenant courtesy delay as workday.mjs — only multi-page tenants pay it.
const INTER_PAGE_DELAY_MS = 150;

// iCIMS serves 200 directly to a browser-like UA (verified live); the default
// career-ops UA risks WAF interstitials, same as workday/glints.
const HEADERS = {
  'user-agent': BROWSER_LIKE_USER_AGENT,
  'accept-language': 'en-US,en;q=0.9',
};

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOrigin(entry) {
  // entry.api takes precedence over careers_url (mirrors greenhouse/ashby).
  for (const raw of [entry.api, entry.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch { continue; }
    if (parsed.protocol !== 'https:') continue;
    if (!parsed.hostname.endsWith('.icims.com')) continue;
    return parsed.origin;
  }
  return null;
}

// in_iframe=1 selects the lighter portal-only markup; pr is the 0-based page.
const searchUrl = (origin, page) => `${origin}/jobs/search?ss=1&pr=${page}&in_iframe=1`;

/**
 * Parse one iCIMS search-results page. Exported for unit tests.
 *
 * Postings are `<li class="iCIMS_JobCardItem">` cards: posting URL in an
 * `iCIMS_Anchor` href (`/jobs/{id}/{title-slug}/job`, query stripped), title
 * in the anchor's `<h3>`, location in the card's `field-label">Location`
 * span. Cards whose href resolves off-origin are dropped (defense in depth —
 * a portal page should never link a posting on another host).
 *
 * @param {string} html
 * @param {string} origin   e.g. "https://careers-acme.icims.com"
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseIcimsSearchPage(html, origin, companyName) {
  const jobs = [];
  const cards = String(html).split('iCIMS_JobCardItem').slice(1);
  for (const card of cards) {
    const href = card.match(/href="(https:\/\/[^"]+\/jobs\/\d+\/[^"/]+\/job)[^"]*"/);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href[1]); } catch { continue; }
    if (parsed.origin !== origin) continue;
    const title = card.match(/<h3\s*>\s*([\s\S]*?)<\/h3>/);
    if (!title || !title[1].trim()) continue;
    const location = card.match(/field-label">Location<\/span>\s*<span\s*>\s*([\s\S]*?)<\/span>/);
    jobs.push({
      title: decodeEntities(title[1].replace(/\s+/g, ' ').trim()),
      url: href[1],
      company: companyName,
      location: location ? decodeEntities(location[1].replace(/\s+/g, ' ').trim()) : '',
      // no postedAt — iCIMS list pages have no date; see enrichDate.
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'icims',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: searchUrl(origin, 0) } : null;
  },

  async fetch(entry, ctx) {
    throw new Error('icims: not implemented yet');
  },

  async enrichDate(job, ctx) {
    throw new Error('icims: not implemented yet');
  },
};
