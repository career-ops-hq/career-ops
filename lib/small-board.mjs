/**
 * small-board.mjs — the shared notion of a "small" ATS board.
 *
 * A resolved board that lists only a handful of postings is often the wrong
 * one (a vendor demo tenant, or a regional sub-board that is not the
 * company's main one). audit-portals.mjs and discover-ats.mjs both flag it,
 * so the threshold and the wording live here and cannot drift apart (#4772).
 */

/** Boards at or under this many postings are worth a second look, not an error. */
export const DEFAULT_SMALL_THRESHOLD = 5;

/**
 * Whether a posting count counts as a small board. A threshold of 0 (or any
 * non-positive value) turns the check off.
 *
 * @param {number} count
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isSmallBoard(count, threshold = DEFAULT_SMALL_THRESHOLD) {
  return threshold > 0 && count <= threshold;
}

/**
 * The one-line explanation shown next to a small board.
 * @param {number} count
 * @returns {string}
 */
export function smallBoardDetail(count) {
  return `only ${count} posting(s) — confirm this is the right board`;
}
