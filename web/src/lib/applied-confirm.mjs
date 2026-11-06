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
 * @param {{ askedSelection?: string, askedCursor?: number, selection?: string, cursor?: number }} [input]
 * @returns {boolean}
 */
export function appliedPromptStale({ askedSelection = "", askedCursor = -1, selection = "", cursor = -1 } = {}) {
  if (selection !== askedSelection) return true;
  return selection === "" && cursor !== askedCursor;
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
