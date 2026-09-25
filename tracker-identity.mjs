/**
 * tracker-identity.mjs — when are two same-title tracker rows provably
 * DIFFERENT openings?
 *
 * merge-tracker.mjs already treats a confirmed posting-URL mismatch (#1298) and
 * a confirmed req/job-id mismatch (#1524) as proof two rows are not duplicates.
 * dedup-tracker.mjs and verify-pipeline.mjs compared company + title only, so
 * one employer's per-location or per-country copies of a title — each with its
 * own URL and job id — were deleted by dedup-tracker and warned about forever
 * by verify-pipeline, even though merge-tracker had kept them apart on purpose.
 * This module is where those readers agree on what "provably distinct" means.
 *
 * Kept out of tracker-parse.mjs deliberately: that module is a bootstrap path
 * the updater loads before the rest of an update lands, and several suites copy
 * it into a sandbox on its own, so it must not grow imports.
 */

import { extractReqNumber } from './tracker-parse.mjs';
import { normalizeUrl } from './url-key.mjs';

/**
 * Evidence that two rows are provably different openings, or null.
 *
 * Only a mismatch counts. A key missing on either side proves nothing, so the
 * caller keeps its existing behaviour for rows without a URL or id.
 *
 * @param {{url?: string, notes?: string}} a - First parsed row (tracker row,
 *   or any object with a posting URL and a notes string).
 * @param {{url?: string, notes?: string}} b - Second parsed row.
 * @returns {string|null} A short human-readable reason, or null.
 */
export function distinctOpeningEvidence(a, b) {
  const urlA = normalizeUrl(a?.url ?? '');
  const urlB = normalizeUrl(b?.url ?? '');
  if (urlA && urlB && urlA !== urlB) return 'distinct posting URLs';
  const reqA = extractReqNumber(a?.notes);
  const reqB = extractReqNumber(b?.notes);
  if (reqA && reqB && reqA !== reqB) return `distinct req/job ids (${reqA} vs ${reqB})`;
  return null;
}
