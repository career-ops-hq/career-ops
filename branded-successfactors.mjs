/**
 * Detect SAP SuccessFactors career sites that run behind an employer's own
 * domain (#5739, follow-up to #3697/#3912).
 *
 * `atsVendorOf()` only sees the URL host, so `jobs.example.com` on SuccessFactors
 * is labelled by hostname and never reaches `providers/successfactors.mjs`.
 * `detectBrandedSuccessFactors()` is the pure, offline half: it reads an already
 * fetched career-page body (and optional response headers) for stable markers.
 * `classifyUnknownHostSeeds()` is the opt-in half: it probes each distinct
 * unknown host at most once through an injected fetcher and relabels only hosts
 * the detector confirms. A failed probe never changes a label.
 */
import { KNOWN_ATS_VENDORS } from './ats-vendor.mjs';
import { atsBoardUrlOf } from './history-ats-seeds.mjs';

const SF_HOST =
  '[a-z0-9.-]*(?:successfactors\\.(?:com|eu)|sapsf\\.(?:com|eu|cn)|jobs2web\\.com)';

// Asset-bearing tags only. A plain <a href> to successfactors.com (a blog
// post, a vendor footer) is not evidence that the page itself is served by it.
const SF_ASSET_RE = new RegExp(
  `<(?:script|link|img|iframe)\\b[^>]*?\\b(?:src|href|data-src)\\s*=\\s*["']?(?:https?:)?//${SF_HOST}(?=[/:"'?#\\s>]|$)`,
  'i',
);

// Signatures of the two page families providers/successfactors.mjs scrapes.
// RMK (ex-jobs2web): the tile fragment endpoint, or a job-tile list carrying
// the jobTitle-link anchors the provider parses.
const RMK_ENDPOINT_RE = /\/tile-search-results\/?(?:\?|["'\s<])/i;
const RMK_TILE_RE = /class\s*=\s*["'][^"']*\bjob-tile\b[^"']*["']/i;
const RMK_TITLE_LINK_RE = /class\s*=\s*["'][^"']*\bjobTitle-link\b/i;
// CSB (Career Site Builder): the unified-search script or its jobs API path.
const CSB_API_RE = /\/services\/recruiting\/v1\/jobs\b/i;
const CSB_SCRIPT_RE = /\bsearchResultsUnify(?:\.min)?\.js\b/i;

const SF_HEADER_RE = new RegExp(`(?:^|[\\s;,<"'/.])${SF_HOST}(?=[\\s;,>"'/:]|$)`, 'i');

function headerValues(headers) {
  if (!headers) return [];
  const out = [];
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    headers.forEach((value, key) => {
      if (/^(?:link|set-cookie|content-security-policy)$/i.test(key)) out.push(String(value));
    });
    return out;
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (!/^(?:link|set-cookie|content-security-policy)$/i.test(key)) continue;
      if (Array.isArray(value)) out.push(...value.map(String));
      else if (value != null) out.push(String(value));
    }
  }
  return out;
}

/**
 * @param {unknown} html Fetched career-page body.
 * @param {Headers|Record<string, string|string[]>|null} [headers] Optional response headers.
 * @returns {boolean} true only when the page carries SuccessFactors markers.
 */
export function detectBrandedSuccessFactors(html, headers = null) {
  const body = typeof html === 'string' ? html : '';
  if (body) {
    if (SF_ASSET_RE.test(body)) return true;
    if (RMK_ENDPOINT_RE.test(body)) return true;
    if (RMK_TILE_RE.test(body) && RMK_TITLE_LINK_RE.test(body)) return true;
    if (CSB_SCRIPT_RE.test(body)) return true;
    if (CSB_API_RE.test(body) && /\bsuccessfactors\b|\bsapsf\b|\bjobs2web\b/i.test(body)) return true;
  }
  return headerValues(headers).some((value) => SF_HEADER_RE.test(value));
}

/**
 * Build the default probe around fetchTextHead: body capped at maxBytes, and the
 * response headers captured through onResponse so header-only markers count.
 * @param {(url: string, opts: object) => Promise<string>} fetchHead
 */
export function makeHeadProbe(fetchHead, maxBytes = 262144) {
  return async (url) => {
    let headers = null;
    const html = await fetchHead(url, {
      maxBytes,
      onResponse: (response) => { headers = response?.headers ?? null; },
    });
    return { html, headers };
  };
}

/** A seed is "unknown-host" when its vendor label is just a hostname. */
export function isUnknownHostSeed(seed) {
  return Boolean(seed?.vendor)
    && !KNOWN_ATS_VENDORS.includes(seed.vendor)
    && seed.vendor === safeHostname(seed.careersUrl);
}

function safeHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Relabel unknown-host seeds whose host is a branded SuccessFactors site.
 *
 * @param {Array<{company:string,vendor:string,careersUrl:string,source?:string}>} seeds
 * @param {object} options
 * @param {(url: string) => Promise<{html?: string, headers?: any}|string|null>} options.probe
 *   Injected fetcher, called once per host with the first seed URL seen on it
 *   (a real career/posting page, not the bare origin, which may redirect or be
 *   a generic homepage). Throwing, or returning null, means
 *   "no verdict" and leaves every seed on that host untouched.
 * @param {Map<string, boolean|null>} [options.cache] Per-host verdicts (host to
 *   true/false, null for a failed probe). Pass the same Map across calls to reuse.
 * @param {number} [options.concurrency]
 * @returns {Promise<Array>} seeds, with confirmed hosts routed to successfactors
 *   (`probeConfirmed: true` lets the sweep skip URL-only detect(), like an
 *   explicit `provider: successfactors` in portals.yml).
 */
export async function classifyUnknownHostSeeds(seeds, { probe, cache = new Map(), concurrency = 4 } = {}) {
  if (typeof probe !== 'function' || !Array.isArray(seeds)) return seeds;

  const probeUrlByHost = new Map();
  for (const seed of seeds) {
    if (!isUnknownHostSeed(seed)) continue;
    const host = seed.vendor;
    if (cache.has(host) || probeUrlByHost.has(host)) continue;
    try {
      const u = new URL(seed.careersUrl);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.toLowerCase() === host) {
        u.hash = '';
        probeUrlByHost.set(host, u.href);
      }
    } catch { /* skip */ }
  }

  const pending = [...probeUrlByHost.entries()];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const [host, probeUrl] = pending[next++];
      let verdict = null;
      try {
        const res = await probe(probeUrl);
        if (typeof res === 'string') verdict = detectBrandedSuccessFactors(res);
        else if (res && typeof res === 'object') verdict = detectBrandedSuccessFactors(res.html, res.headers);
      } catch { verdict = null; }
      cache.set(host, verdict);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker));

  const out = [];
  const seen = new Set();
  for (const seed of seeds) {
    let result = seed;
    if (isUnknownHostSeed(seed) && cache.get(seed.vendor) === true) {
      const careersUrl = atsBoardUrlOf(seed.careersUrl, 'successfactors');
      if (careersUrl) result = { ...seed, vendor: 'successfactors', careersUrl, probeConfirmed: true };
    }
    const key = `${result.vendor}\t${result.careersUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}
