// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Empfehlungsbund provider — public, server-rendered search pages at
// https://en.empfehlungsbund.de/jobs/search. The site has no documented
// anonymous listing API; job cards are present in the initial HTML, so this
// parser keeps scans token-free and avoids a browser dependency. The German
// host rate-limits Node's TLS client (429) while the official EN locale serves
// the same public listings to it, so every accepted portal URL is canonicalized
// to that source host.

const SOURCE_HOST = 'en.empfehlungsbund.de';
const TRUSTED_HOSTS = new Set(['www.empfehlungsbund.de', SOURCE_HOST]);
const SEARCH_PATH = '/jobs/search';
const DEFAULT_SEARCH_URL = `https://${SOURCE_HOST}${SEARCH_PATH}`;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 100;

/** @param {string} value */
function clean(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : '';
}

/** Resolve an entry URL to the trusted public search endpoint. */
export function resolveSearchUrl(entry) {
  const raw = entry?.api || entry?.careers_url || DEFAULT_SEARCH_URL;
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !TRUSTED_HOSTS.has(url.hostname.toLowerCase())) return null;
    const source = new URL(DEFAULT_SEARCH_URL);
    source.search = url.search;
    return source.href;
  } catch {
    return null;
  }
}

/**
 * Parse one public search page into raw job rows. Every card is parsed in
 * isolation so an employer or location cannot be paired with the next card.
 *
 * @param {string} html
 * @param {string} origin
 * @returns {{ id: string, title: string, url: string, company: string, location: string }[]}
 */
export function parseJobCards(html, origin) {
  if (typeof html !== 'string') return [];
  const cards = html.split(/<div\b[^>]*\bclass=(?:"[^"]*\bjob-element\b[^"]*"|'[^']*\bjob-element\b[^']*')[^>]*>/i).slice(1);
  const out = [];
  const seen = new Set();

  for (const card of cards) {
    const link = /<a\b[^>]*\bclass=(?:"[^"]*\bstretched-link\b[^"]*"|'[^']*\bstretched-link\b[^']*')[^>]*>([\s\S]*?)<\/a>/i.exec(card);
    if (!link || link.index == null) continue;
    const tag = link[0].slice(0, link[0].indexOf('>') + 1);
    const href = attribute(tag, 'href');
    const title = clean(link[1]);
    if (!href || !title) continue;

    let url;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    const idMatch = url.pathname.match(/^\/jobs\/(\d+)(?:\/|$)/);
    if (url.protocol !== 'https:' || !TRUSTED_HOSTS.has(url.hostname.toLowerCase()) || !idMatch || seen.has(idMatch[1])) continue;

    const companyAnchor = [...card.matchAll(/<a\b[^>]*>/gi)].find((match) => attribute(match[0], 'href').includes('/partner_profil/'));
    const company = companyAnchor ? clean(attribute(companyAnchor[0], 'title')) : '';
    const afterTitle = card.slice(link.index + link[0].length);
    const locationMatch = /<div\b[^>]*\bclass=(?:"[^"]*\btext-muted\b[^"]*\bsmall\b[^"]*"|'[^']*\btext-muted\b[^']*\bsmall\b[^']*')[^>]*>([\s\S]*?)<\/div>/i.exec(afterTitle);
    const location = locationMatch ? clean(locationMatch[1]) : '';

    seen.add(idMatch[1]);
    out.push({ id: idMatch[1], title, url: `${url.origin}${url.pathname}`, company, location });
  }
  return out;
}

/** @param {object} entry */
function resolveMaxPages(entry) {
  const value = entry?.max_pages;
  if (Number.isInteger(value) && value > 0) return Math.min(value, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'empfehlungsbund',

  detect(entry) {
    const raw = entry?.api || entry?.careers_url;
    return typeof raw === 'string' && resolveSearchUrl({ api: raw }) ? { url: raw } : null;
  },

  async fetch(entry, ctx) {
    const resolved = resolveSearchUrl(entry);
    if (!resolved) throw new Error(`empfehlungsbund: cannot resolve public search URL for ${entry.name}`);
    const maxPages = resolveMaxPages(entry);
    const seen = new Set();
    const jobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(resolved);
      url.searchParams.set('page', String(page));
      const html = await ctx.fetchText(url.href, {
        headers: { accept: 'text/html' },
        redirect: 'error',
      });
      const rows = parseJobCards(html, url.origin);
      if (rows.length === 0) {
        if (page === 1) console.warn(`empfehlungsbund: page 1 returned no job cards for ${entry.name} — markup may have changed`);
        break;
      }

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({
          title: row.title,
          url: row.url,
          company: row.company,
          location: row.location,
        });
      }
      if (fresh === 0) break;
    }
    return jobs;
  },
};
