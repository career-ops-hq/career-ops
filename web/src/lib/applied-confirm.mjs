export const APPLIED_CONFIRM_PROMPT = "Did you submit this application?";
export const APPLIED_CONFIRM_YES = "Yes, mark applied";

/**
 * @param {Iterable<string>} keys
 * @returns {string}
 */
export function appliedSelectionToken(keys) {
  return [...keys].sort().join("\n");
}

/**
 * @param {{ askedSelection?: string, askedCursor?: number, askedCursorKey?: string, selection?: string, cursor?: number, cursorKey?: string }} [input]
 * @returns {boolean}
 */
export function appliedPromptStale({
  askedSelection = "",
  askedCursor = -1,
  askedCursorKey = "",
  selection = "",
  cursor = -1,
  cursorKey = "",
} = {}) {
  if (selection !== askedSelection) return true;
  if (selection !== "") return false;
  if (cursor !== askedCursor) return true;
  return cursorKey !== askedCursorKey;
}

/**
 * @param {string} next
 * @param {string} prev
 * @returns {"keep" | "ask" | "save"}
 */
export function statusEditAction(next, prev) {
  if (next === prev) return "keep";
  if (!appliedWriteAllowed({ status: next, confirmed: false }).write) return "ask";
  return "save";
}

/**
 * @param {{ status?: string, confirmed?: boolean }} [input]
 * @returns {{ write: boolean, prompt: string | null, yesLabel: string | null }}
 */
export function appliedWriteAllowed({ status, confirmed = false } = {}) {
  if (status !== "Applied") return { write: true, prompt: null, yesLabel: null };
  if (confirmed === true) return { write: true, prompt: null, yesLabel: null };
  return { write: false, prompt: APPLIED_CONFIRM_PROMPT, yesLabel: APPLIED_CONFIRM_YES };
}
