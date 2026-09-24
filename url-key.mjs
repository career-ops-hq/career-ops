/**
 * url-key.mjs — canonical posting-URL key for deterministic tracker dedup.
 *
 * Two URLs that point to the same job posting must produce the same key so the
 * merge can upsert on it (the stable natural key — see merge-tracker.mjs Pass 0).
 *
 * UNDER-STRIP ON PURPOSE. The two failure modes are asymmetric:
 *   - over-normalizing collapses two genuinely different postings into one key
 *     → a SILENT merge / data loss (the exact bug this whole change fixes);
 *   - under-normalizing leaves two spellings of the SAME posting as two keys
 *     → a VISIBLE duplicate row you can see and fix.
 * So we strip only a denylist of known tracking params, lowercase the host,
 * force https, drop non-identity fragments + a trailing slash, and sort the
 * remaining query — and KEEP every functional query param (e.g. gh_jid, which
 * on some corporate-hosted Greenhouse boards is the canonical posting id).
 *
 * This mirrors RFC 3986 §6, whose comparison ladder runs simple-string →
 * syntax-based → scheme-based → protocol-based, and whose stated design goal is
 * to "minimize false negatives while strictly avoiding false positives" — the
 * same asymmetry above. Case and trailing-dot-segment handling are §6.2.2
 * syntax-based normalization and are always safe. Dropping query parameters is
 * NOT: the RFC puts scheme/protocol-specific knowledge on a higher rung that
 * requires knowing the resource. So the denylist stays narrow and literal, and
 * generic names (ref, source, src) are deliberately NOT stripped — they are
 * functional on some boards, and stripping them would merge two distinct
 * postings, which is the failure direction the RFC tells us to avoid.
 *
 * NO KEY IS NOT A KEY. An input that is not a usable http(s) posting URL
 * returns '' — never a lowercased-string stand-in. A placeholder like "N/A" or
 * "TBD" is a sentinel for a MISSING value, and SQL's three-valued logic is the
 * settled answer here: NULL is never equal to NULL, and a comparison against it
 * is UNKNOWN rather than true. Returning s.toLowerCase() gave every "N/A" row
 * one shared key, so unrelated employers compared equal on it.
 *
 * Used by merge-tracker.mjs. Kept in its own module so scan.mjs / scan-history
 * can adopt the same key later without the definitions drifting.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Query params that identify a click/campaign, never the posting itself. Keep
// this list literal and board-specific; see the RFC note above on why generic
// names are absent.
const TRACKING_PARAMS = [
  /^utm_/i, /^gh_src$/i, /^fbclid$/i, /^gclid$/i,
  /^mc_cid$/i, /^mc_eid$/i, /^igshid$/i, /^_hsenc$/i, /^_hsmi$/i, /^trk$/i, /^trackingid$/i,
];

// Multi-employer job boards that re-list requisitions hosted elsewhere. One
// opening routinely carries a LinkedIn URL, an Indeed URL and the employer's
// own ATS URL at the same time, so two of these URLs are two spellings of an
// unknown posting rather than two postings. Registrable domains only; keep the
// list literal and conservative, for the same reason TRACKING_PARAMS is. Adding
// an employer-controlled host here would let a fuzzy title collision merge two
// genuinely distinct requisitions, which is the silent failure direction.
// The scraper list is shared with scan.mjs (data-static/aggregator-domains.txt,
// #4263) so a newly discovered reposter is added in ONE place.
//
// It does not answer this module's question on its own. That file lists hosts
// that SCRAPE AND REPOST, and deliberately omits the big job boards because
// companies post to them directly as a primary board — its header says exactly
// that about indeed.com. url-key.mjs asks something broader: is this URL
// EMPLOYER-CONTROLLED? For a board that carries a company's own posting under
// its own URL the answer is still no, because the same requisition also lives
// on the employer's ATS, which is the duplicate this module exists to collapse.
//
// So the shared file is the base and these are layered on top, each named with
// the reason it is absent there. Dropping any of them would silently un-fix the
// case this whole change is for: one posting seen on LinkedIn and on the
// employer board landing twice.
const AGGREGATOR_SUPPLEMENT = [
  'indeed.com',      // primary board; excluded from the shared file by its header
  'linkedin.com',    // primary board; employers post directly
  'glassdoor.com',   // primary board; employers post directly
  'ziprecruiter.com', // primary board; employers post directly
  'dice.com',        // primary board for tech; employers post directly
  'wellfound.com',   // primary board for startups; employers post directly
];

/** Path to the shared scraper list, overridable the same way scan.mjs allows. */
const AGGREGATOR_DOMAINS_PATH = process.env.CAREER_OPS_AGGREGATOR_DOMAINS
  || join(dirname(fileURLToPath(import.meta.url)), 'data-static/aggregator-domains.txt');

// Read once, lazily: this module is imported by merge-tracker.mjs and scan.mjs
// on every run, and it stays a pure function module until something actually
// asks about an aggregator.
//
// Read directly rather than importing scan.mjs's loader: scan.mjs already
// imports THIS module, so depending on it back would be a cycle and would pull
// scan.mjs's whole import graph into merge-tracker's path.
let aggregatorDomainsCache = null;
function aggregatorDomains() {
  if (aggregatorDomainsCache) return aggregatorDomainsCache;
  const domains = new Set(AGGREGATOR_SUPPLEMENT);
  try {
    for (let line of readFileSync(AGGREGATOR_DOMAINS_PATH, 'utf-8').replace(/\r/g, '').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const domain = line.split('#')[0].trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  } catch {
    // A missing shared file leaves the supplement, which still covers the
    // boards this module's dedup actually turns on.
  }
  aggregatorDomainsCache = domains;
  return aggregatorDomainsCache;
}

/**
 * Fold a hostname to its comparison form: lowercase, with the DNS root label
 * dropped.
 *
 * `example.com.` and `example.com` are the same name — the terminal dot is the
 * root label written explicitly — but WHATWG URL preserves it verbatim. Both
 * exported functions below parse the host themselves, so without one shared
 * fold the same posting yields two keys in `normalizeUrl` (dedup sees two rows
 * where there is one) AND slips past `isAggregatorUrl` (an aggregator gets
 * treated as an employer board, which is the direction that turns a non-signal
 * back into false evidence of a distinct requisition).
 *
 * Exactly one dot is stripped. `example.com..` is not a valid host, so it is
 * left alone rather than silently repaired into a key that would match a real
 * posting, and a bare root host is left as-is — rejecting it is a separate
 * decision this does not make.
 *
 * @param {string} host - A hostname from a parsed URL.
 * @returns {string} The folded hostname.
 */
function foldHostname(host) {
  const h = String(host).toLowerCase();
  return h.length > 1 && h.endsWith('.') && !h.endsWith('..') ? h.slice(0, -1) : h;
}

// Posting-ID extractors, keyed by the registrable aggregator domain above.
//
// WHY AN ID AND NOT THE HOST. "Aggregator on either side → unknown" is too
// coarse: it also swallows two DIFFERENT requisitions listed on the SAME board,
// and folding those rewrites an Applied row's URL to a posting nobody applied
// to. The host itself cannot separate the two cases — the posting ID can.
//
// ONLY VERIFIED SHAPES GO IN HERE, and an unmapped board is not a defect. A
// guessed regex that reads two spellings of one posting as two IDs splits that
// posting into two rows, which is the failure direction this file exists to
// avoid; a missing extractor merely leaves the pair UNKNOWN, i.e. exactly the
// behaviour shipped for #3652. The two below are the shapes this repo already
// resolves in liveness-api.mjs (see its `linkedin` provider) and exercises in
// tests/liveness-api-linkedin.test.mjs — not inferred from the URLs' looks.
//
// Extractors are keyed on the DOMAIN, never on the path: `/jobs/view/{id}` is
// also Workable's employer-board shape, where it means something else.
const AGGREGATOR_POSTING_ID = {
  // linkedin.com/jobs/view/{id} · .../jobs/view/{title-slug}-{id} · any page
  // that carries the posting in ?currentJobId= (search and collection views).
  'linkedin.com': (u) => {
    const path = u.pathname.match(/^\/jobs\/view\/(?:.*-)?(\d+)\/?$/);
    if (path) return path[1];
    const current = u.searchParams.get('currentJobId');
    return current && /^\d+$/.test(current) ? current : null;
  },
  // indeed.com/viewjob?jk={id}; a results page carries the focused posting as
  // ?vjk={id}. The job key is the requisition, so region hosts (uk./www./de.)
  // and the two page shapes all reduce to it.
  'indeed.com': (u) => {
    const jk = u.searchParams.get('jk') ?? u.searchParams.get('vjk');
    return jk && /^[\w-]+$/.test(jk) ? jk : null;
  },
};

/**
 * Parse a posting URL and resolve the aggregator it is hosted on.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {{url: URL, domain: string}|null} null when it is not on a known one.
 */
function parseAggregator(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return null; }
  const host = foldHostname(url.hostname);
  // Label boundary, never a substring: `linkedin.com.evil.example` and
  // `myindeed.com` both contain an aggregator domain and are neither.
  let domain = null;
  for (const d of aggregatorDomains()) {
    if (host === d || host.endsWith(`.${d}`)) { domain = d; break; }
  }
  return domain ? { url, domain } : null;
}

/**
 * Is this posting URL hosted by a multi-employer aggregator?
 *
 * Callers use it to decide whether a URL mismatch is evidence about identity.
 * Between two employer-controlled boards it is; as soon as an aggregator is on
 * either side the HOSTS alone say nothing, because the same requisition appears
 * on both — see aggregatorPostingId for the signal that survives that.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {boolean} True only for a parseable URL on a known aggregator.
 */
export function isAggregatorUrl(raw) {
  return parseAggregator(raw) !== null;
}

/**
 * Extract the requisition identity an aggregator URL carries.
 *
 * Two of these are comparable ONLY when `domain` matches: one opening is listed
 * on LinkedIn and on Indeed at the same time, so a LinkedIn id and an Indeed id
 * differing is a statement about two boards, not about two postings.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {{domain: string, id: string}|null} null means UNKNOWN — not on a
 *   known aggregator, no extractor for that board yet, or no id in the URL.
 *   Callers must never read null as "the same posting".
 */
export function aggregatorPostingId(raw) {
  const agg = parseAggregator(raw);
  if (!agg) return null;
  const id = AGGREGATOR_POSTING_ID[agg.domain]?.(agg.url) ?? null;
  return id ? { domain: agg.domain, id } : null;
}

/**
 * Promote a known identity-bearing SPA fragment into a functional query key
 * before generic URL normalization drops the fragment. Most fragments are
 * presentation-only. The narrow exceptions are recognized `#/job/{id}` and
 * `#/jobs/{id}` routes; MokaHR keeps its established board-specific key.
 *
 * The emitted/public URL remains untouched; this mutates only the URL object
 * used to build a comparison key.
 *
 * @param {URL} url
 */
export function promoteKnownFragmentIdentity(url) {
  const match = /^#\/jobs?\/([^/?#]+)(?:\?[^#]*)?$/i.exec(url.hash);
  if (!match) return;
  let jobId;
  try { jobId = decodeURIComponent(match[1]); } catch { return; }
  if (!jobId) return;
  if (url.hostname.toLowerCase() === 'app.mokahr.com') {
    url.searchParams.append('mokahr_job_id', jobId);
    return;
  }
  url.searchParams.append('_career_ops_fragment_job_id', jobId);
}

/**
 * Reduce a posting URL to a stable comparison key.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {string} A normalized key, or '' when there is nothing to key on.
 *   '' means NO KEY — callers must treat it as unknown, never as a value that
 *   can match another ''.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  let u;
  try {
    u = new URL(s);
  } catch {
    // Not a parseable absolute URL: a placeholder ("N/A", "TBD", "—"), a
    // `local:jds/...` pipeline reference, or free text. None of these identify a
    // posting, so none of them may become a key.
    return '';
  }

  // Only http(s) postings can be keyed. A non-http scheme is not a posting
  // locator we can compare, so it yields no key rather than a string stand-in.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';

  u.protocol = 'https:';            // http vs https is the same posting
  u.hostname = foldHostname(u.hostname);
  promoteKnownFragmentIdentity(u);
  u.hash = '';                      // unrecognized fragments do not identify it

  // Drop tracking params, keep functional ones, sort for order-independence.
  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!TRACKING_PARAMS.some((re) => re.test(k))) keep.push([k, v]);
  }
  keep.sort((x, y) => (x[0] !== y[0] ? (x[0] < y[0] ? -1 : 1) : (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  // Drop a single trailing slash on the path (but never the root "/").
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

export default normalizeUrl;
