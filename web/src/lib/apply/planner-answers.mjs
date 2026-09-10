/**
 * planner-answers.mjs - normalize the planner's raw JSON into usable answers.
 *
 * `extractJsonObject` returns whatever object it could recover from the model's
 * output, including from a truncated one. That object is not trustworthy: a
 * field may be a bare string, a number, null, or an object missing the keys the
 * prompt asked for. Coercing it here means the callers never branch on shape.
 *
 * Plain .mjs and no imports, for the reason extract-json-object.mjs is: this is
 * the boundary where model output becomes something a form-filler will act on,
 * and `web/`'s runner only loads .mjs.
 *
 * The rule that matters is `needs_confirmation === true`, strictly. The planner
 * sets it on the fields it is told never to fill (legal, visa, work
 * authorization, salary, demographic). Any looser test - truthiness, a string
 * "false", a missing key read as absent - turns a refusal into a silent
 * confirmation, and a fabricated visa answer is worse than no answer.
 */

/**
 * @typedef {Object} PlannerAnswer
 * @property {string} value
 * @property {boolean} needs_confirmation
 */

/**
 * @param {Record<string, unknown>} obj Raw object recovered from the planner.
 * @returns {Record<string, PlannerAnswer>} Only the entries that were usable.
 */
export function toAnswers(obj) {
  /** @type {Record<string, PlannerAnswer>} */
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [key, raw] of Object.entries(obj)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = typeof raw.value === "string" ? raw.value : "";
    out[key] = { value, needs_confirmation: raw.needs_confirmation === true };
  }
  return out;
}
