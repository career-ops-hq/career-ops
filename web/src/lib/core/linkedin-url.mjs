/**
 * LinkedIn posting-URL parser — algorithm mirror of the `linkedin` provider in
 * the core's liveness-api.mjs (#3179 / #3180).
 *
 * Plain .mjs (same pattern as url-key.mjs / normalize-text-key.mjs) so node:test
 * and client bundles can import it without a TS runner or Node-only deps — this
 * file has none, same as the core rung it mirrors (only the global `URL`).
 *
 * WHY A COPY EXISTS AT ALL: the live core lives in the user's career-ops
 * checkout and is resolved at runtime via careerOpsRoot(), which the client
 * bundle cannot reach. liveness-api.mjs additionally imports './user-agent.mjs'
 * and keeps this rung inside its ATS_PROVIDERS table rather than exporting it,
 * so there is nothing importable to depend on yet. Both consumers here are
 * client-reachable (job-store.tsx normalizes a pasted URL before it fires a
 * worker), so both sides import this one mirror.
 *
 * THIS FILE IS A TEMPORARY SHAPE. The maintainer's decision on #2995 is that the
 * parser lives canonically in the core, extracted into a shared importable
 * module, and every consumer imports that one body. When that extraction lands,
 * delete this file and import the real thing; the parity test below is what
 * makes that swap a one-liner instead of a re-derivation.
 *
 * Keep the body byte-for-byte aligned with the `linkedin` provider's `match()`
 * and `api()` in liveness-api.mjs. The parity test in
 * tests/lib/linkedin-url.test.mjs loads the core provider through resolveAtsApi
 * and fails the build if the two drift.
 *
 * DELIBERATELY NOT "IMPROVED" HERE. An earlier draft of this parser required 6+
 * digits for the slug form (so a title ending in "-2" could not be read as a job
 * id) and matched the path case-insensitively and unanchored. Those are
 * defensible, but a mirror that is stricter than its core is drift by another
 * name: it makes the two disagree on real inputs while the parity test still
 * passes on the cases someone happened to write down. If the 6-digit floor is
 * right, it belongs in liveness-api.mjs, where the liveness ladder gets it too.
 */

/**
 * The numeric LinkedIn job id carried by this URL, or null when it is not one
 * posting. Matched as digits only, so nothing user-supplied is ever spliced into
 * a hostname.
 *
 * Three recognized shapes, exactly as the core rung reads them:
 *   linkedin.com/jobs/view/{id}
 *   linkedin.com/jobs/view/{title-slug}-{id}
 *   any page carrying the posting in ?currentJobId= (search and collection views)
 *
 * The host test is anchored at a dot boundary, so "linkedin.com.evil.example"
 * never matches. `u.hostname` is already lowercased by the URL parser.
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function linkedInJobId(u) {
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
  const path = u.pathname.match(/^\/jobs\/view\/(?:.*-)?(\d+)\/?$/);
  if (path) return path[1];
  const current = u.searchParams.get("currentJobId");
  return current && /^\d+$/.test(current) ? current : null;
}

/**
 * The public guest endpoint for a posting id: the rendered posting body, with no
 * auth and no browser. `id` is always the digits-only capture above, so the host
 * here stays a fixed literal and nothing user-supplied reaches it.
 *
 * @param {string} id
 * @returns {string}
 */
export function linkedInGuestUrl(id) {
  return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
}

/**
 * The canonical, clickable link for a posting id — what the report header and the
 * tracker row record. Not part of the core mirror: the core only ever needs the
 * API URL, while this app also has to hand the user something to click.
 *
 * @param {string} id
 * @returns {string}
 */
export function linkedInCanonicalUrl(id) {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}
