/**
 * Canonical posting-URL key — algorithm mirror of the core's `normalizeUrl`
 * in url-key.mjs (root).
 *
 * Plain .mjs (same pattern as normalize-text-key.mjs) so node:test and client
 * bundles can import it without a TS runner or Node-only deps — this file has
 * none, same as the core it mirrors (only the global `URL`).
 *
 * WHY A COPY EXISTS AT ALL: the live core lives in the user's career-ops
 * checkout and is resolved at runtime via careerOpsRoot() — unavailable to the
 * client bundle. Unlike normalize-text-key.mjs's split (a Node-only live
 * loader server-side, this mirror client-side), the URL key here is used to
 * build ONE Set server-side (assembleDedupContext, from data/scan-history.tsv)
 * that the CLIENT then does membership lookups against on each AI-streamed
 * offer (explore-ai.ts's canon()). Server and client MUST key with the exact
 * same function or `known.has(key)` silently stops matching anything — so both
 * sides import this one mirror rather than the server preferring a live-loaded
 * copy that could drift from what the client bundle was built with.
 *
 * Keep the body byte-for-byte aligned with url-key.mjs `normalizeUrl`. The
 * parity test in tests/lib/url-key.test.mjs fails the build if they drift.
 *
 * UNDER-STRIP ON PURPOSE (see the root file's docstring for the full RFC 3986
 * rationale). Never add path/query lowercasing or a broader strip list here:
 * that is exactly the over-normalization that collapsed two different
 * Greenhouse postings (same host+path, distinct `?gh_jid=`) into one dedup
 * key and silently dropped every opening after the first at that employer —
 * the bug this mirror exists to stop reintroducing.
 */

// Query params that identify a click/campaign, never the posting itself. Keep
// this list literal and board-specific, identical to the core's denylist.
const TRACKING_PARAMS = [
  /^utm_/i, /^gh_src$/i, /^fbclid$/i, /^gclid$/i,
  /^mc_cid$/i, /^mc_eid$/i, /^igshid$/i, /^_hsenc$/i, /^_hsmi$/i, /^trk$/i, /^trackingid$/i,
];

/**
 * Reduce a posting URL to a stable comparison key.
 *
 * @param {string} raw - A posting URL (or any string).
 * @returns {string} A normalized key, or '' when there is nothing to key on.
 *   '' means NO KEY — callers must treat it as unknown, never as a value that
 *   can match another ''.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";

  let u;
  try {
    u = new URL(s);
  } catch {
    return "";
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return "";

  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";

  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!TRACKING_PARAMS.some((re) => re.test(k))) keep.push([k, v]);
  }
  keep.sort((x, y) => (x[0] !== y[0] ? (x[0] < y[0] ? -1 : 1) : (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

export default normalizeUrl;
