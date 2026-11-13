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

/** Read-back issues the green banner treats as a failed fill. */
export function readbackIssues(issues) {
  return (issues || []).filter((issue) => READBACK_ISSUE_CODES.has(issue?.code));
}

/** Drop an earlier read-back so a later fill or drive can replace it. */
export function withoutReadbackIssues(issues) {
  return (issues || []).filter((issue) => !READBACK_ISSUE_CODES.has(issue?.code));
}
