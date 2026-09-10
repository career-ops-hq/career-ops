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
 * force https, drop the fragment + a trailing slash, and sort the remaining
 * query — and KEEP every functional query param (e.g. gh_jid, which on some
 * corporate-hosted Greenhouse boards is the canonical posting id).
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
const AGGREGATOR_DOMAINS = [
  'adzuna.com', 'builtin.com', 'careerbuilder.com', 'dice.com', 'glassdoor.com',
  'indeed.com', 'jooble.org', 'linkedin.com', 'monster.com', 'simplyhired.com',
  'talent.com', 'wellfound.com', 'ziprecruiter.com',
];

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

/**
 * Is this posting URL hosted by a multi-employer aggregator?
 *
 * Callers use it to decide whether a URL mismatch is evidence about identity.
 * Between two employer-controlled boards it is; as soon as an aggregator is on
 * either side it is not, because the same requisition appears on both.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {boolean} True only for a parseable URL on a known aggregator.
 */
export function isAggregatorUrl(raw) {
  if (typeof raw !== 'string') return false;
  let host;
  try { host = foldHostname(new URL(raw.trim()).hostname); } catch { return false; }
  // Label boundary, never a substring: `linkedin.com.evil.example` and
  // `myindeed.com` both contain an aggregator domain and are neither.
  return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Promote a known identity-bearing SPA fragment into a functional query key
 * before generic URL normalization drops the fragment. Most fragments are
 * presentation-only; MokaHR is the narrow exception because every job shares
 * the tenant path and the posting ID exists only in `#/job/{id}`.
 *
 * The emitted/public URL remains untouched; this mutates only the URL object
 * used to build a comparison key.
 *
 * @param {URL} url
 */
export function promoteKnownFragmentIdentity(url) {
  if (url.hostname.toLowerCase() !== 'app.mokahr.com') return;
  const match = /^#\/job\/([^/?#]+)(?:\?[^#]*)?$/.exec(url.hash);
  if (!match) return;
  let jobId;
  try { jobId = decodeURIComponent(match[1]); } catch { return; }
  if (jobId) url.searchParams.set('mokahr_job_id', jobId);
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
  u.hash = '';                      // fragments never identify the posting

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
