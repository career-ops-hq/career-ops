export const APPLIED_CONFIRM_PROMPT = "Did you submit this application?";
export const APPLIED_CONFIRM_YES = "Yes, mark applied";

/**
 * @param {{ status?: string, confirmed?: boolean }} [input]
 * @returns {{ write: boolean, prompt: string | null, yesLabel: string | null }}
 */
export function appliedWriteAllowed({ status, confirmed = false } = {}) {
  if (status !== "Applied") return { write: true, prompt: null, yesLabel: null };
  if (confirmed === true) return { write: true, prompt: null, yesLabel: null };
  return { write: false, prompt: APPLIED_CONFIRM_PROMPT, yesLabel: APPLIED_CONFIRM_YES };
}
