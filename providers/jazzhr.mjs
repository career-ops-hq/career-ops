// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.applytojob\.com$/i;
const MAX_JOBS = 1000;
const DETAIL_DEFAULT_LIMIT = 25;

function parseBoardUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || !HOST_RE.test(url.hostname)) return null;
    if (!/^\/apply(?:\/|$)/i.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

function resolveBoardUrl(entry) {
  for (const raw of [entry.api, entry.careers_url]) {
    const parsed = parseBoardUrl(raw);
    if (parsed) return parsed;
  }
  return null;
}

function assertJazzHRUrl(raw) {
  const parsed = parseBoardUrl(raw);
  if (!parsed) throw new Error(`jazzhr: untrusted or invalid public board URL: ${raw}`);
  return parsed;
}

function clean(value) {
  return htmlToText(typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim();
}

function parseJsonLd(html) {
  const out = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (Array.isArray(parsed?.['@graph'])) out.push(...parsed['@graph']);
      else out.push(parsed);
    } catch { /* unrelated analytics JSON */ }
  }
  return out;
}

function locationText(location) {
  const places = Array.isArray(location) ? location : [location];
  for (const place of places) {
    const address = place?.address || {};
    const values = [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter((v) => typeof v === 'string' && v.trim());
    if (values.length) return values.join(', ');
  }
  return '';
}

/** @param {string} html @param {string} boardUrl @param {string} companyName */
export function parseJazzHRList(html, boardUrl, companyName) {
  if (typeof html !== 'string') return [];
  const base = new URL(boardUrl);
  const jobs = [];
  const seen = new Set();
  const cardRe = /<li\b[^>]*class=["'][^"']*list-group-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(cardRe)) {
    const card = match[1];
    const link = card.match(/<a\b[^>]*href=["']([^"']*\/apply\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url;
    try {
      url = new URL(link[1], base);
      if (url.protocol !== 'https:' || url.hostname !== base.hostname || !/^\/apply\//i.test(url.pathname)) continue;
      url.search = '';
    } catch { continue; }
    const title = clean(link[2]);
    if (!title || seen.has(url.href)) continue;
    const location = clean((card.match(/fa-map-marker[^<]*<\/i>\s*([^<]+)/i) || [])[1] || '');
    seen.add(url.href);
    jobs.push({ title, url: url.href, company: companyName || '', location });
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

/** @param {string} html @param {any} job */
export function parseJazzHRDetail(html, job) {
  const node = parseJsonLd(html).find((item) => item && (item['@type'] === 'JobPosting' || (Array.isArray(item['@type']) && item['@type'].includes('JobPosting'))));
  if (!node) return job;
  if (!job.title && typeof node.title === 'string') job.title = clean(node.title);
  const description = clean(node.description);
  if (description) job.description = description;
  const location = locationText(node.jobLocation);
  if (location) job.location = location;
  if (typeof node.datePosted === 'string') {
    const parsed = Date.parse(node.datePosted);
    if (!Number.isNaN(parsed)) job.postedAt = parsed;
  }
  return job;
}

function config(entry) {
  const cfg = entry?.jazzhr || {};
  const limit = Number.isInteger(cfg.detailLimit) && cfg.detailLimit > 0 ? Math.min(cfg.detailLimit, 100) : DETAIL_DEFAULT_LIMIT;
  return { fetchDetails: cfg.fetchDetails === true, detailLimit: limit };
}

/** @type {Provider} */
export default {
  id: 'jazzhr',
  detect(entry) {
    const board = resolveBoardUrl(entry);
    return board ? { url: board.href } : null;
  },
  async fetch(entry, ctx) {
    const board = resolveBoardUrl(entry);
    if (!board) throw new Error(`jazzhr: cannot derive public ApplyToJob board URL for ${entry.name}`);
    const html = await fetchTextWithRetry(ctx, board.href, { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html' } });
    const jobs = parseJazzHRList(html, board.href, entry.name);
    const { fetchDetails, detailLimit } = config(entry);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    if (fetchDetails && !probing) {
      for (const job of jobs.slice(0, detailLimit)) {
        try {
          const detailUrl = assertJazzHRUrl(job.url);
          const detail = await fetchTextWithRetry(ctx, detailUrl.href, { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html' } });
          parseJazzHRDetail(detail, job);
        } catch { /* optional enrichment must not erase a valid list row */ }
      }
    }
    return jobs;
  },
  async enrichDate(job, ctx) {
    const detailUrl = assertJazzHRUrl(job.url);
    const html = await fetchTextWithRetry(ctx, detailUrl.href, { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html' } });
    parseJazzHRDetail(html, job);
  },
};

export { parseBoardUrl, resolveBoardUrl, assertJazzHRUrl };
