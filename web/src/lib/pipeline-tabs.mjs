/**
 * pipeline-tabs.mjs — the canonical Pipeline tab list.
 *
 * The tab strip, the assistant's `filterPipeline` action and the Config page's
 * "default tab" dropdown all read this one list, so a tab can never be offered
 * in one of them and rejected by another.
 *
 * Plain .mjs, dependency-free (same pattern as job-url.mjs / pdf-paths.mjs) so
 * the sibling test suite can import it under bare Node with no DOM.
 */

/**
 * @typedef {"INBOX"|"ALL"|"EVALUATED"|"APPLIED"|"RESPONDED"|"INTERVIEW"|"OFFER"
 *   |"HIRED"|"REJECTED"|"DISCARDED"|"SKIP"} PipelineTab
 */

/** INBOX is the triage queue; every other tab filters the tracker by status.
 *  @type {readonly PipelineTab[]} */
export const PIPELINE_TABS = [
  "INBOX",
  "ALL",
  "EVALUATED",
  "APPLIED",
  "RESPONDED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "DISCARDED",
  "SKIP",
];

/** The tab to land on when the user has expressed no preference. */
export const FALLBACK_PIPELINE_TAB = /** @type {PipelineTab} */ ("INBOX");

/**
 * A tab value from an untrusted source (URL query, profile.yml, an assistant
 * intent) as a canonical tab, or null when it names no tab we have. Never
 * throws and never guesses: an unknown value falls back at the call site.
 *
 * @param {unknown} value
 * @returns {PipelineTab|null}
 */
export function normalizePipelineTab(value) {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /** @type {readonly string[]} */ (PIPELINE_TABS).includes(upper)
    ? /** @type {PipelineTab} */ (upper)
    : null;
}
