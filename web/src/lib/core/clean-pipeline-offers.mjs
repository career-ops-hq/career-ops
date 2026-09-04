/**
 * Validate and canonicalize offers before they reach data/pipeline.md.
 *
 * pipeline.ts's `addOffersToPipeline` writes a DURABLE user-layer file through
 * the core's own `appendToPipeline` / `appendToScanHistory` writers — every
 * future inbox row and dedupe key is read back out of it. Whatever URL a
 * client (the paste dialog, a discovery card "Add to pipeline") handed us must
 * not reach disk verbatim: a raw LinkedIn link still carrying "?trk=..." would
 * split the same posting's identity across pipeline.md and a freshly-launched
 * evaluate worker's canonical job.input, which is exactly the bug this module
 * closes (see job-url.mjs's header).
 *
 * Plain .mjs (same pattern as normalize-text-key.mjs) so this — the actual
 * behavior change — is unit-testable under bare `node --test` without spawning
 * the writer subprocess or touching a real pipeline.md.
 */

import { normalizeJobUrl } from "../job-url.mjs";
import { isJdRef } from "../jd-source.mjs";

/**
 * @typedef {Object} CleanPipelineOffer
 * @property {string} url
 * @property {string} company
 * @property {string} title
 * @property {string} location
 * @property {string} source
 * @property {string} note
 */

/**
 * @param {ReadonlyArray<{url?: unknown, company?: string, title?: string, location?: string, source?: string, ats?: string, note?: string}>} offers
 * @returns {CleanPipelineOffer[]} one entry per offer whose url normalizes to a
 *   real job posting URL, in the same order, with that url replaced by its
 *   canonical form. An offer whose url does not normalize is dropped, not
 *   passed through raw.
 */
export function cleanPipelineOffers(offers) {
  const out = [];
  for (const o of offers ?? []) {
    if (!o || typeof o.url !== "string") continue;
    // A `local:jds/…` reference is a posting with no URL — a JD the user pasted
    // or uploaded, archived under jds/ (see jd-source.mjs). It is already
    // canonical (its filename is a hash of the JD's own text), it is validated
    // strictly enough to be joined onto a path, and normalizeJobUrl would refuse
    // it for the same reason it refuses file: and javascript:. So it passes
    // through here instead of being dropped, and the row it produces in
    // data/pipeline.md is the form modes/pipeline.md already reads.
    if (isJdRef(o.url)) {
      out.push({
        url: o.url,
        company: o.company || "",
        title: o.title || "",
        location: o.location || "",
        source: o.source || "pasted-jd",
        note: o.note || "",
      });
      continue;
    }
    const normalized = normalizeJobUrl(o.url);
    if (!normalized.ok) continue;
    out.push({
      url: normalized.url,
      company: o.company || "",
      title: o.title || "",
      location: o.location || "",
      source: o.source || o.ats || "explorer",
      // Preserve the optional per-offer signal so it survives to pipeline.md.
      // The core writer treats an empty note as absent (byte-identical output).
      note: o.note || "",
    });
  }
  return out;
}
