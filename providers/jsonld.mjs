// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Generic JSON-LD `JobPosting` provider — reads schema.org structured data
// (https://schema.org/JobPosting) that many career sites embed in a
// `<script type="application/ld+json">` block purely for search-engine SEO.
//
// EXPLICIT-OPT-IN ONLY, NEVER AUTO-DETECTED. `detect()` requires
// `provider: jsonld` in portals.yml. JobPosting markup is a public SEO
// convention a large share of the web emits — auto-detecting it would let
// this provider silently claim careers pages other providers already own
// (a company running Greenhouse/Lever/Ashby AND emitting JobPosting JSON-LD
// for SEO is common, not rare). Every other provider in this repo pins
// itself to a fixed API host it knows in advance; this one is handed an
// arbitrary `careers_url` by the user, so that pattern has nothing to
// compare against — see the host-validation note on resolveJsonLdUrl() below,
// and the PR body for the open question this raises.
//
// One GET of the careers page, no pagination, no auth — the cheapest
// possible new provider in request budget. Parses every `application/ld+json`
// block, accepts a bare JobPosting object, an array of them, or a `@graph`
// document containing them (the same three shapes providers/icims.mjs
// already flattens for its own narrower JSON-LD use of `datePosted`).

import { htmlToText } from './_html-to-text.mjs';
import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const HEADERS = { 'user-agent': BROWSER_LIKE_USER_AGENT, accept: 'text/html' };

// A script tag ends at the first `</script>` — the shared regex icims.mjs
// uses, so a CSP nonce on the tag (`<script nonce="..." type="...">`)
// doesn't break matching by requiring `type` to be the first attribute.
const LD_JSON_SCRIPT_RE = /<script\b[^>]*(?<![\w-])type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * SSRF guard for a URL the user supplies directly, with no fixed host to pin
 * against. Structural validation only — https, a registrable public-looking
 * hostname, no IP literal, no loopback/link-local/internal name — mirrors
 * providers/consider.mjs's resolveOrigin(), the closest existing precedent
 * for a config-driven (not provider-fixed) host. The process-wide DNS-
 * rebinding guard (providers/_ip-guard.mjs) still validates whatever address
 * the hostname actually resolves to underneath this.
 *
 * OPEN QUESTION (see PR body): every other provider validates against a host
 * it knows in advance; this is the first one where the "trusted" host is
 * entirely the user's choice. This is the most defensible bounded version
 * available, not a claim that it's the final word.
 *
 * @param {{ careers_url?: string, api?: string }} entry
 * @returns {string | null} The validated absolute URL, or null.
 */
function resolveJsonLdUrl(entry) {
  const raw = entry?.careers_url || entry?.api || '';
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  let host = parsed.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1); // strip FQDN trailing dot
  if (host.startsWith('[') || host.includes(':')) return null;        // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;              // IPv4 literal (incl. metadata/private)
  if (host === 'localhost' || host === 'localhost.localdomain') return null;
  if (host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!host.includes('.')) return null;                              // single-label / non-public
  return parsed.href;
}

/** Flatten one parsed JSON-LD blob into a list of candidate nodes. */
function flattenLdJson(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data['@graph'])) return data['@graph'];
  return data ? [data] : [];
}

function isJobPosting(node) {
  const type = node && node['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function clean(value) {
  return String(value ?? '').trim();
}

/** One schema.org Place/PostalAddress → "Locality, Region, Country". */
function placeToString(place) {
  if (!place) return '';
  if (typeof place === 'string') return clean(place);
  if (typeof place !== 'object') return '';
  const addr = place.address;
  if (addr && typeof addr === 'object') {
    const country = addr.addressCountry && typeof addr.addressCountry === 'object'
      ? clean(addr.addressCountry.name)
      : clean(addr.addressCountry);
    const parts = [clean(addr.addressLocality), clean(addr.addressRegion), country].filter(Boolean);
    if (parts.length) return parts.join(', ');
  } else if (typeof addr === 'string') {
    return clean(addr);
  }
  return clean(place.name);
}

/** jobLocation may be absent, a bare string, one Place, or an array of Places. */
function extractLocation(node) {
  const raw = node.jobLocation;
  const places = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const parts = [...new Set(places.map(placeToString).filter(Boolean))];
  if (parts.length) return parts.join(', ');
  if (String(node.jobLocationType || '').toUpperCase().includes('TELECOMMUTE')) return 'Remote';
  return '';
}

function extractCompany(node, entry) {
  const org = node.hiringOrganization;
  if (typeof org === 'string' && org.trim()) return org.trim();
  if (org && typeof org === 'object' && typeof org.name === 'string' && org.name.trim()) return org.name.trim();
  return clean(entry?.name);
}

/**
 * Normalize the flattened, filtered JobPosting nodes on one page into Job
 * entries. Exported for unit tests.
 *
 * A node's own `url` wins when present (resolved against the page URL, so a
 * relative link still normalizes). When a node has no `url` AND it is the
 * only JobPosting on the page, the page URL itself stands in — a common
 * shape for a single-posting detail page. A node with no `url` on a page
 * that lists MULTIPLE postings is dropped: without a distinct URL there is
 * no reliable per-job dedup key, and reusing the page URL for all of them
 * would silently collapse them into one entry.
 *
 * @param {any[]} nodes - Already flattened and filtered to `@type: JobPosting`.
 * @param {string} pageUrl - The careers page URL that was fetched.
 * @param {{ name?: string }} entry
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function normalizeJsonLdJobs(nodes, pageUrl, entry) {
  const out = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const title = clean(node.title || node.name);
    if (!title) continue;

    let url = '';
    const rawUrl = typeof node.url === 'string' ? node.url.trim() : '';
    if (rawUrl) {
      try { url = new URL(rawUrl, pageUrl).href; } catch { url = ''; }
    }
    if (!url) {
      if (nodes.length > 1) continue; // no reliable per-job dedup key
      url = pageUrl;
    }

    /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}} */
    const job = {
      title,
      url,
      company: extractCompany(node, entry),
      location: extractLocation(node),
    };

    const desc = htmlToText(node.description);
    if (desc) job.description = desc;

    const ts = Date.parse(String(node.datePosted || ''));
    if (!Number.isNaN(ts)) job.postedAt = ts;

    out.push(job);
  }
  return out;
}

/**
 * Extract every JobPosting node embedded as `application/ld+json` on a page.
 * Throws when the page carries no such node at all — a config error (wrong
 * URL, or the site dropped the markup) — so it surfaces loudly instead of
 * masquerading as a real empty board. A node that parses but is missing a
 * usable title/url is dropped individually by normalizeJsonLdJobs(), which
 * is a data-quality issue rather than a shape mismatch and does not throw.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @param {{ name?: string }} entry
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseJsonLdJobs(html, pageUrl, entry) {
  const nodes = [];
  for (const [, raw] of String(html).matchAll(LD_JSON_SCRIPT_RE)) {
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    for (const node of flattenLdJson(data)) {
      if (isJobPosting(node)) nodes.push(node);
    }
  }
  if (nodes.length === 0) {
    throw new Error(`jsonld: no application/ld+json JobPosting found at ${pageUrl} — check careers_url points at a page that still emits JobPosting structured data`);
  }
  return normalizeJsonLdJobs(nodes, pageUrl, entry);
}

/** @type {Provider} */
export default {
  id: 'jsonld',

  detect(entry) {
    if (!entry || entry.provider !== 'jsonld') return null;
    const url = resolveJsonLdUrl(entry);
    return url ? { url } : null;
  },

  /**
   * @param {{ name?: string, careers_url?: string, api?: string }} entry
   * @param {{ fetchText: (url: string, opts?: object) => Promise<string> }} ctx
   */
  async fetch(entry, ctx) {
    const url = resolveJsonLdUrl(entry);
    if (!url) throw new Error(`jsonld: ${entry?.name || 'entry'} needs an https careers_url (or api) on a public host`);

    // redirect:'error' is the SSRF guard for the second hop (a server-side
    // redirect can't be followed to a private address); resolveJsonLdUrl()
    // above is the guard for the first hop.
    const html = await ctx.fetchText(url, { headers: HEADERS, redirect: 'error' });
    return parseJsonLdJobs(html, url, entry);
  },
};
