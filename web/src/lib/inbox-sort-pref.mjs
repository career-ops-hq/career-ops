/**
 * The pipeline inbox's sort choice, remembered per browser.
 *
 * Same shape as the evaluation-section checklist: a `career-ops:` localStorage
 * key, read after mount (the server has no localStorage, so the first render
 * always uses the default), and every storage call guarded because private
 * mode and blocked storage throw. A stored value that is not a known mode
 * (hand-edited, or left by a build that no longer has it) reads as the default.
 */
export const INBOX_SORT_STORAGE_KEY = "career-ops:inbox-sort";
export const INBOX_SORT_MODES = Object.freeze(["fit", "newest"]);
export const DEFAULT_INBOX_SORT = "fit";

/**
 * @param {unknown} value
 * @returns {"fit" | "newest"}
 */
export function parseInboxSort(value) {
  return INBOX_SORT_MODES.includes(/** @type {string} */ (value)) ? /** @type {"fit" | "newest"} */ (value) : DEFAULT_INBOX_SORT;
}

/**
 * @param {Pick<Storage, "getItem"> | null | undefined} storage
 * @returns {"fit" | "newest"}
 */
export function readInboxSort(storage) {
  try {
    return parseInboxSort(storage?.getItem(INBOX_SORT_STORAGE_KEY));
  } catch {
    return DEFAULT_INBOX_SORT;
  }
}

/**
 * Returns whether the choice was stored. The caller keeps the choice for this
 * visit either way.
 *
 * @param {Pick<Storage, "setItem"> | null | undefined} storage
 * @param {unknown} mode
 * @returns {boolean}
 */
export function writeInboxSort(storage, mode) {
  if (!storage || !INBOX_SORT_MODES.includes(/** @type {string} */ (mode))) return false;
  try {
    storage.setItem(INBOX_SORT_STORAGE_KEY, /** @type {string} */ (mode));
    return true;
  } catch {
    return false;
  }
}
