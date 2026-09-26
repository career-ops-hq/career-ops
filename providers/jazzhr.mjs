// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JazzHR provider — scrapes the public, server-rendered ApplyToJob career
// page. Auto-detects from careers_url/api on any `*.applytojob.com` https
// host. This is a single-company ATS adapter driven entirely from
// `tracked_companies:` in portals.yml — there is no public directory of
// ApplyToJob tenants to enumerate, so unlike greenhouse/lever/ashby/
// workday/icims this provider is never wired into scan-ats-full.mjs's
// reverse sweep.
//
// Board resolution follows the same shape as providers/bamboohr.mjs and
// providers/breezy.mjs: only the hostname is trusted from config —
// whatever path (or port) a `careers_url`/`api` happens to carry is
// discarded, and the canonical board URL (`https://<hostname>/apply`) is
// always rebuilt from the hostname alone. That sidesteps validating the
// input path's shape entirely; a bare host, `/apply`, `/apply/`, a
// non-default port, or even a stray deep path all resolve to the same
// board.
//
// The board is one page with no pagination — every posting is in the
// initial HTML. Title/URL/location come from the list markup; an opt-in
// `jazzhr: { fetchDetails: true, detailLimit: N }` portal entry additionally
// fetches each posting's own page (capped at `detailLimit`, default 25, max
// 100) for its JSON-LD description and posted date.
//
// Card recognition tries the `list-group-item` wrapper first (title +
// location together); a bare `/apply/` permalink-anchor pass then runs
// unconditionally alongside it (title only, deduped against the wrapper
// pass) — a markup redesign that renames or drops the wrapper still yields
// real postings instead of reading as a healthy empty board, even when
// only some cards on the page have migrated off it.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.applytojob\.com$/i;
const MAX_JOBS = 1000;
const DETAIL_DEFAULT_LIMIT = 25;
// Courtesy delay between back-to-back detail-page requests to the same
// tenant, same pattern as the inter-page delays in providers/careerviet.mjs
// / providers/itviec.mjs — avoids a WAF burst trigger on a loop that can
// fire up to 100 requests with no pacing.
const DETAIL_FETCH_DELAY_MS = 200;

/** Resolve the tenant origin (`https://<tenant>.applytojob.com`) from an
 * entry — honours an explicit `api:` URL, else `careers_url`. Mirrors
 * providers/bamboohr.mjs / providers/breezy.mjs: hostname is validated,
 * then the origin is rebuilt from it rather than carried through from the
 * input, so a port has nowhere to survive to — nothing to separately
 * check or reject. */
function resolveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try { parsed = new URL(raw.trim()); } catch { continue; }
    if (parsed.protocol !== 'https:' || !HOST_RE.test(parsed.hostname)) continue;
    return `https://${parsed.hostname}`;
  }
  return null;
}

const boardUrl = (origin) => `${origin}/apply`;

/** Re-gates a URL against the same host allowlist before a network call —
 * used for a posting permalink before its detail fetch. Only HTTPS + the
 * `HOST_RE` hostname match are checked; the path is not otherwise
 * constrained, since it's a specific posting's own permalink, not a board
 * root to normalize. */
function assertJazzHRUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw).trim()); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || !HOST_RE.test(parsed.hostname)) {
    throw new Error(`jazzhr: untrusted or invalid public board URL: ${raw}`);
  }
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

/** Matches a posting permalink anchor anywhere in the page — the one part of
 * a JazzHR board's markup a redesign is least likely to change, since it is
 * the URL shape the site itself needs for the apply flow to work. */
const POSTING_LINK_RE = /<a\b[^>]*href=["']([^"']*\/apply\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** @param {string} href @param {URL} base */
function resolvePostingUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (url.origin !== base.origin || !/^\/apply\/[^/].*$/i.test(url.pathname)) return null;
    url.search = '';
    return url;
  } catch { return null; }
}

/** @param {string} html @param {string} boardHref @param {string} companyName */
export function parseJazzHRList(html, boardHref, companyName) {
  if (typeof html !== 'string') return [];
  const base = new URL(boardHref);
  const jobs = [];
  const seen = new Set();
  const addJob = (url, title, location) => {
    if (!title || seen.has(url.href)) return;
    seen.add(url.href);
    jobs.push({ title, url: url.href, company: companyName || '', location });
  };

  // Primary: the list-group-item card wrapper carries both title and
  // location together, so it is tried first when present.
  const cardRe = /<li\b[^>]*class=["'][^"']*list-group-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(cardRe)) {
    const card = match[1];
    const link = card.match(/<a\b[^>]*href=["']([^"']*\/apply\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = resolvePostingUrl(link[1], base);
    if (!url) continue;
    const location = clean((card.match(/fa-map-marker[^<]*<\/i>\s*([^<]+)/i) || [])[1] || '');
    addJob(url, clean(link[2]), location);
    if (jobs.length >= MAX_JOBS) break;
  }

  // Fallback: `list-group-item` is a markup detail, not a JazzHR guarantee —
  // a redesign that renames or drops that wrapper while keeping the /apply/
  // permalink shape would otherwise read as a healthy empty board. Anchor
  // directly on the posting link instead. Runs unconditionally, not only
  // when the primary pass found nothing — a partial redesign (some cards
  // still wrapped, some not) would otherwise silently drop the unwrapped
  // postings with no signal at all, worse than losing all of them. `seen`
  // (shared with the primary pass) makes this safe: a posting the primary
  // pass already added is skipped here, so this only ever adds a title/url
  // the primary pass missed, never a duplicate or a downgrade.
  for (const match of html.matchAll(POSTING_LINK_RE)) {
    const url = resolvePostingUrl(match[1], base);
    if (!url) continue;
    addJob(url, clean(match[2]), '');
    if (jobs.length >= MAX_JOBS) break;
  }

  // Presence checks below require a real segment after `/apply/`, matching
  // `resolvePostingUrl`'s own requirement — a bare `/apply/` href (JazzHR's
  // own "back to listings" nav link, present even on a genuinely empty
  // board) otherwise reads as evidence of an unparsed posting and throws a
  // false alarm on a tenant with zero open positions.
  const POSTING_HREF_RE = /<a\b[^>]*href=["'][^"']*\/apply\/[^"']+["']/i;
  if (jobs.length === 0 && POSTING_HREF_RE.test(html)) {
    throw new Error('jazzhr: found ApplyToJob links but could not parse any posting cards');
  }
  if (jobs.length >= MAX_JOBS && [...html.matchAll(new RegExp(POSTING_HREF_RE.source, 'gi'))].length > MAX_JOBS) {
    console.error(`⚠️  jazzhr: capped results at max_jobs=${MAX_JOBS}; additional postings were not returned`);
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
  // Only overwrite from the detail page when the list value is empty or a
  // literal "n/a" (mirrors icims.mjs's enrichDate guard) — the list page
  // often carries a fuller location than the detail JSON-LD, so an
  // unconditional overwrite silently downgrades it (e.g. "Berlin, Berlin,
  // Germany" from the list to just "Berlin" from a detail page missing
  // country), which matters because location_filter matches on this field.
  if (!String(job.location || '').trim() || /^n\/?a$/i.test(String(job.location).trim())) {
    const location = locationText(node.jobLocation);
    if (location) job.location = location;
  }
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
    const origin = resolveOrigin(entry);
    return origin ? { url: boardUrl(origin) } : null;
  },
  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`jazzhr: cannot derive public ApplyToJob board URL for ${entry.name}`);
    const board = boardUrl(origin);
    const html = await fetchTextWithRetry(ctx, board, { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html' } });
    const jobs = parseJazzHRList(html, board, entry.name);
    const { fetchDetails, detailLimit } = config(entry);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    if (fetchDetails && !probing) {
      const targets = jobs.slice(0, detailLimit);
      for (let i = 0; i < targets.length; i++) {
        if (i > 0) await sleep(DETAIL_FETCH_DELAY_MS, ctx);
        const job = targets[i];
        try {
          const detailUrl = assertJazzHRUrl(job.url);
          const detail = await fetchTextWithRetry(ctx, detailUrl.href, { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html' } });
          parseJazzHRDetail(detail, job);
        } catch { /* optional enrichment must not erase a valid list row */ }
      }
    }
    return jobs;
  },
};

export { resolveOrigin, assertJazzHRUrl };
