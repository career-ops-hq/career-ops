/**
 * questions.mjs - turn what a candidate pastes into a list of questions.
 *
 * Shared by the job page's panel (which splits a paste as the user types) and by
 * /api/answers (which re-validates whatever arrives, because the client is not
 * the only thing that can post to it). One implementation so the two cannot
 * disagree about what a question is.
 *
 * Plain .mjs and no imports, same reason as extract-json-object.mjs: `web/`'s
 * test runner is `node --test tests/**\/*.test.mjs`.
 */

/** Guard rails on pasted input, so one paste cannot blow up a report. */
export const MAX_QUESTIONS = 40;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ANSWER_CHARS = 20000;

/**
 * Split a pasted block into individual questions.
 *
 * Blank-line separated when the paste uses blank lines, because a single
 * question routinely wraps over several lines ("Describe a workflow you have
 * changed using AI.\nUnder 150 words."). One per line otherwise. Leading list
 * markers are stripped, since people paste out of numbered or bulleted forms.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitQuestions(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const parts = raw.includes("\n\n") ? raw.split(/\n{2,}/) : raw.split("\n");
  return parts
    .map((p) => p.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * The word cap a question states about itself ("under 150 words", "150 words or
 * fewer"). Used for the counter next to the answer box, never to truncate: the
 * cap is the employer's rule, and silently cutting an answer to fit it would be
 * a worse outcome than showing the candidate they are over.
 *
 * @param {string} text
 * @returns {number | undefined} undefined when the question states no cap.
 */
export function wordCapFrom(text) {
  const s = String(text ?? "");
  const hit =
    s.match(/(?:under|below|max(?:imum)?(?:\s+of)?|no more than|fewer than|less than|within)\s+(\d{2,4})\s*words/i) ||
    s.match(/(\d{2,4})\s*words\s*(?:or\s*(?:fewer|less)|max(?:imum)?)/i);
  const n = hit ? Number.parseInt(hit[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 5000 ? n : undefined;
}

/**
 * @typedef {Object} Question
 * @property {string} question
 * @property {string} answer
 * @property {number} [maxWords]
 */

/**
 * Coerce an untrusted list into questions, dropping anything unusable.
 *
 * A question with no text is dropped rather than kept as an empty prompt; an
 * answer is kept as-is (minus the length cap) because it is the candidate's own
 * words and this is not the place to reformat them.
 *
 * @param {unknown} raw
 * @returns {Question[]}
 */
export function sanitizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Question[]} */
  const out = [];
  for (const item of raw.slice(0, MAX_QUESTIONS)) {
    const rec = item && typeof item === "object" ? /** @type {Record<string, unknown>} */ (item) : {};
    const question = String(rec.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) continue;
    const answer = String(rec.answer ?? "").slice(0, MAX_ANSWER_CHARS);
    const maxWords = wordCapFrom(question);
    out.push(maxWords === undefined ? { question, answer } : { question, answer, maxWords });
  }
  return out;
}
