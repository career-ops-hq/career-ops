/**
 * cover-answers.mjs — the cover letter answers, kept with the run that used them.
 *
 * The report page asks modes/cover.md's four Step 6 questions before a cover run
 * (cover-brief.mjs checks the answers at the route). They used to live only in the
 * form's component state and in the request body, so a run that failed left them
 * nowhere: not on the run page, and not in the form when it was opened again after
 * visiting the run log (#7441). The job now keeps them, and these helpers read them
 * back for the run page, the form and the copy a user pastes into an agent CLI.
 *
 * Plain .mjs with no Node imports: both readers are client components, and
 * cover-brief.mjs imports node:path.
 */
import { COVER_TONES } from "./cover-tones.mjs";

/** Step 6's A–C prompts as the report page asks them. D is the tone. */
export const COVER_QUESTIONS = Object.freeze([
  Object.freeze({ step: "A", name: "why", label: "Why this role or company?", hint: "One or two angles: scale, mission, stage, or what you would learn." }),
  Object.freeze({ step: "B", name: "problem", label: "What problem would you solve for them?", hint: "The research step checks this against what the company says publicly." }),
  Object.freeze({ step: "C", name: "approach", label: "How would you approach it on day one?", hint: "One or two sentences. This is the most specific part of the letter." }),
]);

/**
 * @typedef {{why: string, problem: string, approach: string, tone: keyof typeof COVER_TONES | null}} StoredCoverBrief
 */

/**
 * The answers stored on a job, or null when it has none to show.
 *
 * Jobs are restored from localStorage, so the shape is checked rather than
 * trusted: a job saved before answers were kept has none, and a stored value
 * that is not a string reads as unanswered. A tone the form does not offer is
 * dropped rather than shown.
 *
 * @param {unknown} value
 * @returns {StoredCoverBrief | null}
 */
export function storedCoverBrief(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const answer = (key) => (typeof record[key] === "string" ? record[key] : "");
  const tone = typeof record.tone === "string" && Object.hasOwn(COVER_TONES, record.tone)
    ? /** @type {keyof typeof COVER_TONES} */ (record.tone)
    : null;
  const brief = { why: answer("why"), problem: answer("problem"), approach: answer("approach"), tone };
  return COVER_QUESTIONS.some((q) => brief[q.name].trim()) ? brief : null;
}

/**
 * The answers as plain text, lettered as modes/cover.md Step 6 asks for them, so
 * they can be pasted into an agent CLI's cover mode when the web run did not draft
 * the letter.
 *
 * @param {StoredCoverBrief} brief
 * @returns {string}
 */
export function coverAnswersText(brief) {
  const blocks = COVER_QUESTIONS.map((q) => `${q.step}. ${q.label}\n${brief[q.name].trim() || "(no answer)"}`);
  if (brief.tone) blocks.push(`D. Tone\n${COVER_TONES[brief.tone]}`);
  return blocks.join("\n\n");
}
