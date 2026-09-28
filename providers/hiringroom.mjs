// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// HiringRoom provider — a LATAM/AR applicant-tracking system used by many
// companies, each on its own `<company>.hiringroom.com` subdomain. There is no
// public JSON API, so this provider fetches the tenant's microsite and parses
// it in-process (zero-token). Two layouts exist in the wild:
//
//   - legacy `/jobs`: vacancy cards rendered server-side, parsed with the same
//     block-regex approach as providers/nodesk.mjs;
//   - newer `/portal/jobs`: the listing is embedded as schema.org JSON-LD (an
//     ItemList of JobPosting). Tenants on this layout answer `/jobs` with a 302
//     to `/portal`, which the redirect:'error' guard refuses, so their
//     portals.yml entry must point at `/portal/jobs` (`/portal` alone lists
//     only a few featured vacancies).
//
// Per-company pattern (like greenhouse/lever): one portals.yml entry per
// employer. The company label is the entry's `name` in both layouts.

const TRUSTED_HOST = 'hiringroom.com';

/** @param {string} url */
function assertHiringRoomUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`hiringroom: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`hiringroom: URL must use HTTPS: ${url}`);
  const host = parsed.hostname.toLowerCase();
  if (host !== TRUSTED_HOST && !host.endsWith(`.${TRUSTED_HOST}`)) {
    throw new Error(`hiringroom: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST} or a subdomain`);
  }
  return parsed;
}

/** @type {Provider} */
export default {
  id: 'hiringroom',

  detect(entry) {
    const url = entry?.careers_url || '';
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`)) return { url };
    } catch {
      /* not a URL — fall through */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const listUrl = entry.careers_url || '';
    const parsed = assertHiringRoomUrl(listUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertHiringRoomUrl it keeps the request pinned to the hiringroom domain.
    const html = await ctx.fetchText(parsed.href, { redirect: 'error' });
    const company = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'HiringRoom';
    return parseHiringRoomJobs(html, parsed.origin, company);
  },
};

/**
 * Parse a HiringRoom microsite (either layout). Exported for unit tests.
 *
 * JSON-LD is tried first; when the page carries none, the legacy card markup
 * below is parsed instead.
 *
 * Each vacancy is an `<a href="/jobs/get_vacancy/<id>">` wrapping a card whose
 * `<h4 class="… name__vacancy">` holds the title and whose `.hr-Location-pin`
 * icon precedes the location text. Anchors to `…/candidates/new` (the apply
 * link) and blocks without a title are skipped; URLs are deduped.
 *
 * @param {string} html - raw microsite HTML
 * @param {string} origin - e.g. "https://growuphr.hiringroom.com", to absolutize hrefs
 * @param {string} company - fallback/label company (the portals.yml entry name)
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseHiringRoomJobs(html, origin, company = 'HiringRoom') {
  if (typeof html !== 'string') return [];
  const fromJsonLd = parseJsonLdJobs(html, origin, company);
  if (fromJsonLd.length > 0) return fromJsonLd;
  const jobs = [];
  const seen = new Set();

  const anchorRe = /href="(\/jobs\/get_vacancy\/[a-f0-9]+)"/gi;
  const matches = [...html.matchAll(anchorRe)];

  for (let k = 0; k < matches.length; k++) {
    const href = matches[k][1];
    if (/\/candidates\//i.test(href)) continue;

    const start = matches[k].index ?? 0;
    const end = k + 1 < matches.length ? (matches[k + 1].index ?? html.length) : html.length;
    const block = html.slice(start, end);

    const titleM = block.match(/name__vacancy[^>]*>([\s\S]*?)<\/h4>/i);
    if (!titleM) continue;
    const title = decodeEntities(titleM[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const url = origin + href;
    if (seen.has(url)) continue;
    seen.add(url);

    const locM = block.match(/hr-Location-pin[^>]*><\/i>\s*([^<]+)/i);
    const location = locM ? decodeEntities(locM[1]).replace(/\s+/g, ' ').trim() : '';

    jobs.push({ title, url, company, location });
  }

  return jobs;
}

const VACANCY_PATH_RE = /^\/jobs\/get_vacancy\/[a-f0-9]+$/i;

/** @param {string} s */
function htmlToText(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/** @param {unknown} loc */
function jsonLdLocation(loc) {
  const place = Array.isArray(loc) ? loc[0] : loc;
  const address = place && typeof place === 'object' ? /** @type {any} */ (place).address : undefined;
  if (typeof address === 'string') return decodeEntities(address).replace(/\s+/g, ' ').trim();
  if (address && typeof address === 'object') {
    return ['addressLocality', 'addressRegion', 'addressCountry']
      .map(k => address[k])
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => v.trim())
      .join(', ');
  }
  return '';
}

/**
 * Read the schema.org JobPosting entries a `/portal/jobs` page embeds.
 *
 * Posting URLs are rebuilt as `origin + path` and kept only when they point at
 * a vacancy on the tenant's own host: the payload advertises `http://`, and a
 * url on any other host is never followed.
 *
 * @param {string} html
 * @param {string} origin
 * @param {string} company
 */
function parseJsonLdJobs(html, origin, company) {
  const host = new URL(origin).hostname.toLowerCase();
  const jobs = [];
  const seen = new Set();
  const scriptRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(scriptRe)) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const items = Array.isArray(data?.itemListElement) ? data.itemListElement : [];
    for (const el of items) {
      const posting = el?.item;
      if (!posting || posting['@type'] !== 'JobPosting') continue;
      const title = typeof posting.title === 'string' ? htmlToText(posting.title) : '';
      if (!title) continue;

      let parsed;
      try {
        parsed = new URL(String(posting.url));
      } catch {
        continue;
      }
      if (parsed.hostname.toLowerCase() !== host || !VACANCY_PATH_RE.test(parsed.pathname)) continue;
      const url = origin + parsed.pathname;
      if (seen.has(url)) continue;
      seen.add(url);

      /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}} */
      const job = { title, url, company, location: jsonLdLocation(posting.jobLocation) };
      if (typeof posting.description === 'string') {
        const description = htmlToText(posting.description);
        if (description) job.description = description;
      }
      const postedAt = Date.parse(String(posting.datePosted));
      if (Number.isFinite(postedAt)) job.postedAt = postedAt;
      jobs.push(job);
    }
  }
  return jobs;
}
