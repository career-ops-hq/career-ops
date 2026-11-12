/** Issue codes that mean a required answer was not read back as the value we filled. */
export const READBACK_ISSUE_CODES = new Set(["fill-mismatch", "required-empty", "fill-unverified"]);

/**
 * The green "pre-filled" line is only true when the fill finished and every
 * read-back check passed. A wrong radio, an empty required field, or a
 * combobox we could not read keeps it off.
 *
 * @param {string | undefined} status
 * @param {{ code?: string }[] | undefined} issues
 */
export function showPrefilledBanner(status, issues) {
  if (status !== "done") return false;
  return !(issues || []).some((issue) => READBACK_ISSUE_CODES.has(issue?.code));
}
