/**
 * answers-snapshot.mjs - build the payload that a panel save writes back.
 *
 * The job page edits ONE of the four groups in `## Application Answers`:
 * free-text answers. The other three - selections, other field values, files
 * used - are written by the CLI `apply` mode when it fills a real form.
 *
 * `upsertApplicationAnswersSection` replaces the whole section, so a save that
 * sends only `freeText` deletes the other three. That is silent, permanent, and
 * only visible later, when `apply` re-reads the report before an application and
 * finds the uploaded CV and the work-authorization selection gone. This module
 * exists so the "carry the rest back" rule is one function with a test, rather
 * than four lines inside a route handler that a later edit can quietly drop.
 *
 * Plain .mjs and no imports, same reason as extract-json-object.mjs: `web/`'s
 * runner only loads .mjs.
 */

/**
 * @typedef {Object} StoredSnapshot
 * @property {string} [state]
 * @property {unknown[]} [selections]
 * @property {unknown[]} [fieldValues]
 * @property {unknown[]} [files]
 */

const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * Whether a save is allowed to replace the section that is already there.
 *
 * `buildSavePayload` carries the three untouched groups across a save, but it can
 * only carry what the reader handed it. When the reader was unavailable - an
 * older `application-answers.mjs` in the user's checkout that can still be
 * written to but does not export `parseApplicationAnswersSection`, which this
 * module's own loader treats as a normal, expected state - it hands back empty
 * lists that are indistinguishable from a genuinely empty section. Writing those
 * deletes the selections, field values and uploaded CV, and drops a `submitted`
 * section back to `filled`: exactly the loss this module exists to prevent,
 * arriving through the one path that skipped it.
 *
 * So the rule is stated as its own answer rather than left implicit in a
 * default: replace a section only when we know what it holds. Refusing a save is
 * recoverable in a way replacing one is not.
 *
 * @param {{readable: boolean, present: boolean}} stored
 * @returns {boolean} false only when a section exists and was not understood.
 */
export function mayReplaceSection({ readable, present }) {
  return readable === true || present !== true;
}

/**
 * Resolve the state to write.
 *
 * `submitted` is a claim about the real world, so it is only ever set from an
 * explicit request. It is equally never withdrawn by accident: editing a typo in
 * an answer on a section already marked submitted must not reopen it, which is
 * what defaulting to `filled` would do.
 *
 * @param {string | undefined} requested
 * @param {string | undefined} stored
 * @returns {"filled" | "submitted"}
 */
export function resolveState(requested, stored) {
  if (requested === "submitted" || requested === "filled") return requested;
  return stored === "submitted" ? "submitted" : "filled";
}

/**
 * @param {{stored?: StoredSnapshot, questions: Array<{question: string, answer: string}>, state?: string}} opts
 * @returns {{state: string, freeText: Array<{question: string, answer: string}>, selections: unknown[], fieldValues: unknown[], files: unknown[]}}
 */
export function buildSavePayload({ stored = {}, questions = [], state }) {
  return {
    state: resolveState(state, stored.state),
    // Only the two keys the formatter reads. A `maxWords` derived for the UI's
    // word counter is not part of what the employer asked, and must not be
    // rendered into the report as though it were.
    freeText: questions.map((q) => ({ question: q.question, answer: q.answer ?? "" })),
    selections: asList(stored.selections),
    fieldValues: asList(stored.fieldValues),
    files: asList(stored.files),
  };
}
