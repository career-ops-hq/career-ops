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
  u.hostname = u.hostname.toLowerCase();
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
