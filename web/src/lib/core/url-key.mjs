/**
 * Canonical posting-URL key — algorithm mirror of the core's `normalizeUrl`
 * in url-key.mjs (root).
 *
 * Plain .mjs (same pattern as normalize-text-key.mjs) so node:test and client
 * bundles can import it without a TS runner or Node-only deps — this file has
 * none, same as the core it mirrors (only the global `URL`).
 *
 * WHY A COPY EXISTS AT ALL: the live core lives in the user's career-ops
 * checkout and is resolved at runtime via resolveCodeRoot() — unavailable to the
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
 * Match the core URL key's DNS-root-label normalization: one trailing dot
 * names the same host, but two trailing dots must not be silently repaired.
 */
function foldHostname(host) {
  const h = String(host).toLowerCase();
  return h.length > 1 && h.endsWith(".") && !h.endsWith("..") ? h.slice(0, -1) : h;
}

/**
 * Promote a known identity-bearing SPA fragment into a functional query key
 * before generic URL normalization drops the fragment. Most fragments are
 * presentation-only. The narrow exceptions are recognized `#/job/{id}` and
 * `#/jobs/{id}` routes; MokaHR keeps its established board-specific key.
 *
 * @param {URL} url
 */
export function promoteKnownFragmentIdentity(url) {
  const match = /^#\/jobs?\/([^/?#]+)(?:\?[^#]*)?$/i.exec(url.hash);
  if (!match) return;
  let jobId;
  try { jobId = decodeURIComponent(match[1]); } catch { return; }
  if (!jobId) return;
  if (url.hostname.toLowerCase() === "app.mokahr.com") {
    url.searchParams.append("mokahr_job_id", jobId);
    return;
  }
  url.searchParams.append("_career_ops_fragment_job_id", jobId);
}

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
  u.hostname = foldHostname(u.hostname);
  promoteKnownFragmentIdentity(u);
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

// The posting-language rule below mirrors the core's LANGUAGE_PARAMS,
// postingLanguageKey, postingScript, languageSubtag and postingUrlRelation
// (url-key.mjs, root), so What's New suppression reads two language versions
// of one posting the way the tracker does. Keep the bodies aligned with the
// core; the parity tests in tests/lib/url-key.test.mjs reuse its cases. The
// root file's docstrings carry the full rationale.

// Query params naming the language a posting page renders in.
export const LANGUAGE_PARAMS = ["language", "lang", "locale"];

/**
 * The posting a URL names, apart from the language it asks for.
 *
 * @param {unknown} raw - A posting URL (or any string).
 * @returns {{key: string, language: string, script: string}} `key` is '' when
 *   there is no key; `language` is '' when the URL names none.
 */
export function postingLanguageKey(raw) {
  if (typeof raw !== "string") return { key: "", language: "", script: "" };
  let u;
  try { u = new URL(raw.trim()); } catch { return { key: normalizeUrl(raw), language: "", script: "" }; }
  let language = "";
  let script = "";
  for (const name of [...u.searchParams.keys()]) {
    if (!LANGUAGE_PARAMS.includes(name.toLowerCase())) continue;
    if (!language) {
      const raw = u.searchParams.get(name);
      language = languageSubtag(raw);
      script = postingScript(raw);
    }
    u.searchParams.delete(name);
  }
  return { key: normalizeUrl(u.href), language, script };
}

/**
 * The script a posting language param names, or '' when the value does not
 * say: an explicit script subtag, else the one an explicit region implies. A
 * bare `zh` is never resolved to a script.
 *
 * @param {unknown} value - A language param value.
 * @returns {string} A script subtag (`Hant`), or ''.
 */
export function postingScript(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  let loc;
  try { loc = new Intl.Locale(v.replace(/_/g, "-")); } catch { return ""; }
  if (loc.script) return loc.script;
  if (!loc.region) return "";
  try { return loc.maximize().script || ""; } catch { return ""; }
}

/**
 * A posting language reduced to its language subtag (`en-GB` → `en`); a value
 * that does not parse is compared whole, case-folded.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function languageSubtag(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  try {
    return new Intl.Locale(v.replace(/_/g, "-")).language;
  } catch {
    return v.toLowerCase();
  }
}

/**
 * What two posting URLs say about whether they name the same posting:
 * `'no-key'` (either side has no key), `'same'`, `'distinct'` (two pages, or
 * one page in two known languages or scripts) or `'one-sided-language'` (one
 * page with a language on one side only: proof of neither one posting nor two).
 *
 * @param {string} rawA
 * @param {string} rawB
 * @returns {'no-key'|'same'|'distinct'|'one-sided-language'}
 */
export function postingUrlRelation(rawA, rawB) {
  const a = postingLanguageKey(rawA);
  const b = postingLanguageKey(rawB);
  if (!a.key || !b.key) return "no-key";
  if (a.key !== b.key) return "distinct";
  if (a.language === b.language) {
    if (a.language && a.script && b.script && a.script !== b.script) return "distinct";
    return "same";
  }
  return a.language && b.language ? "distinct" : "one-sided-language";
}

export default normalizeUrl;
