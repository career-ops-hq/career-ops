// @ts-check
// One reading of "this board was not fully read", for scan.mjs.
//
// Providers already signal a short read, but each under its own name, tagged
// on the returned jobs array: workdayTruncated, eightfoldTruncated,
// icimsTruncated, jibeapplyTruncated, adpTruncated, phenomTruncated, ... (19
// providers as of v1.39.0). scan.mjs read none of them, so a board cut short by
// a page cap, a 429 or a fetch error was counted as scanned and logged
// `reachable` in the portal-health ledger: partial coverage that looked
// complete.
//
// Google AIP-217 (https://google.aip.dev/217) is the standard shape for this:
// when an operation can partly succeed, the response must say what it could
// not reach, rather than return the partial result as if it were whole. This
// module is that check. A provider can set the canonical
// `jobs.truncated = { reason, fetched?, total? }`; the legacy per-provider
// `<name>Truncated` tags keep working without any provider change.

/**
 * @typedef {{ reason: string, fetched?: number, total?: number, source: string }} BoardTruncation
 */

// `<name>Truncated` on 19 providers; `peoplesoftIncomplete` is the one
// provider that names the same signal `<name>Incomplete`.
const LEGACY_TAG_RE = /^[a-z][A-Za-z0-9]*(?:Truncated|Incomplete)$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
function reasonOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') {
    const r = /** @type {any} */ (value).reason;
    if (typeof r === 'string' && r) return r;
  }
  return 'incomplete';
}

/**
 * Whether a provider's result says the board was only partly read, and why.
 *
 * @param {unknown} jobs - the array a provider's fetch() returned.
 * @returns {BoardTruncation | null}
 */
export function boardTruncation(jobs) {
  if (!Array.isArray(jobs)) return null;
  const anyJobs = /** @type {any} */ (jobs);
  const canonical = anyJobs.truncated;
  if (canonical) {
    /** @type {BoardTruncation} */
    const out = { reason: reasonOf(canonical), source: 'truncated' };
    if (typeof canonical === 'object') {
      if (Number.isFinite(canonical.fetched)) out.fetched = canonical.fetched;
      if (Number.isFinite(canonical.total)) out.total = canonical.total;
    }
    return out;
  }
  for (const key of Object.keys(jobs)) {
    if (!LEGACY_TAG_RE.test(key)) continue;
    const value = anyJobs[key];
    if (!value) continue;
    return { reason: value === true ? 'cap-or-fetch-error' : reasonOf(value), source: key };
  }
  return null;
}

/**
 * Mark a jobs array as partly read, in the canonical shape. Returns the array.
 *
 * @template T
 * @param {T[]} jobs
 * @param {string} reason - short machine-readable cause, e.g. 'page-cap', 'rate-limited'.
 * @param {{ fetched?: number, total?: number }} [counts]
 * @returns {T[]}
 */
export function markTruncated(jobs, reason, counts = {}) {
  /** @type {any} */ (jobs).truncated = { ...counts, reason };
  return jobs;
}

/**
 * One summary fragment, e.g. "Apple (page-cap, 100 of 340)".
 *
 * @param {string} company
 * @param {BoardTruncation} t
 * @returns {string}
 */
export function describeTruncation(company, t) {
  const counts = Number.isFinite(t.fetched) && Number.isFinite(t.total)
    ? `, ${t.fetched} of ${t.total}`
    : Number.isFinite(t.fetched) ? `, ${t.fetched} read` : '';
  return `${company} (${t.reason}${counts})`;
}
