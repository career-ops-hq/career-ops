// Which discovered offers count as "already evaluated" for the Explore /
// "new matches" supply loop (api/whats-new).
//
// Pure JS (no TS types) so it can be imported by the route AND by a
// `node --test` unit test, matching funnel-tiles.mjs / status-alias.mjs /
// clean-chips.mjs — web's test script is `node --test tests/**/*.test.mjs`
// and there is no TS runner.
//
// THE KEY IS COMPANY **AND** ROLE (#3131). Suppressing by employer alone meant
// one evaluated role removed that employer's entire board from Explore,
// permanently, including postings first seen afterwards. An employer with 20+
// live roles went completely invisible after evaluating one of them, and the
// scanner was working throughout — the rows were in scan-history.tsv, only the
// view hid them. "No new matches" then reads identically to "matches exist but
// are suppressed", which is what makes it hard to notice.
//
// The trade is deliberate and in the safer direction. If the tracker's role
// text and the scan-history title drift apart ("Staff SWE" vs "Staff Software
// Engineer"), an already-evaluated role can reappear in Explore once: a
// VISIBLE false positive the user can dismiss. What it replaces is a silent
// false negative — a board the user cannot see and gets no signal about.
//
// The normalizer is injected rather than imported, because the route resolves
// the CORE's normalizeTextKey from the user's own checkout (lib/core/text-key)
// so web dedup always matches CLI dedup. A second key helper here is exactly
// the local reimplementation #2666 removed.

/**
 * Suppression key for one company/role pair.
 *
 * A tracker row with no role yields "company|", which matches only a scan row
 * that also has no title — so a backfilled, role-less row (#1799) suppresses
 * that one shape rather than the whole employer.
 *
 * @param {(value: unknown, separator?: string) => string} norm - Core key fn.
 * @param {string} company
 * @param {string} role
 * @returns {string}
 */
export function suppressionKey(norm, company, role) {
  return `${norm(company, " ")}|${norm(role, " ")}`;
}

/**
 * Keys for every evaluated application.
 *
 * Rows whose company normalizes to nothing are dropped: they cannot identify
 * an employer, and keeping them would let one blank row suppress every scan
 * row whose company is also unkeyable.
 *
 * @param {{company: string, role: string}[]} applications
 * @param {(value: unknown, separator?: string) => string} norm
 * @returns {Set<string>}
 */
export function evaluatedKeys(applications, norm) {
  const keys = new Set();
  for (const app of applications ?? []) {
    if (!norm(app?.company, " ")) continue;
    keys.add(suppressionKey(norm, app?.company ?? "", app?.role ?? ""));
  }
  return keys;
}

/**
 * Has this discovered offer already been evaluated?
 *
 * @param {Set<string>} keys - From evaluatedKeys().
 * @param {(value: unknown, separator?: string) => string} norm
 * @param {string} company - Scan-history company cell.
 * @param {string} title - Scan-history title cell.
 * @returns {boolean}
 */
export function isEvaluated(keys, norm, company, title) {
  if (!company || !norm(company, " ")) return false;
  return keys.has(suppressionKey(norm, company, title));
}
