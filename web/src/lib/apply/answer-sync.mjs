/**
 * answer-sync.mjs - keep the screen, the request in flight, and the report in step.
 *
 * Drafting runs a CLI planner and is allowed up to 320 seconds (see the route's
 * maxDuration). The answer boxes stay editable for all of it, which is the point:
 * a candidate who already knows the answer to question three should not have to
 * sit and watch. The request, though, carried a snapshot of the list taken when
 * they pressed the button, and the response is that snapshot with the blanks
 * filled. Assigning it straight into state replaced everything typed in the
 * meantime with the older text, silently, at the moment the draft landed - which
 * is precisely when the candidate has stopped watching the screen.
 *
 * Two functions, both pure, because both answers are claims the UI makes about
 * data it does not hold:
 *
 * - `mergeDraftedAnswers` - the candidate's keystrokes win. An answer that
 *   changed since it was sent keeps the newer text; only the ones still identical
 *   to what was sent take the drafted version.
 * - `sameAnswers` - whether the list on screen is still the list on disk. This is
 *   what the Save button's "Saved" state means, and deriving it from a comparison
 *   rather than a boolean flag is what stops the flag going stale: there is no
 *   edit path that can forget to clear it, and an edit typed and then undone
 *   correctly goes back to saved.
 *
 * Matching is by question text, not by list position. The route re-validates
 * through sanitizeQuestions, which may drop an unusable entry, and the candidate
 * may add or remove a question while the planner runs, so index i on one side is
 * not index i on the other. Repeated question texts pair in order, first with
 * first.
 *
 * Plain .mjs and no imports, same reason as questions.mjs: `web/`'s test runner
 * is `node --test tests/**\/*.test.mjs`.
 */

/**
 * @typedef {Object} AnswerItem
 * @property {string} question
 * @property {string} [answer]
 * @property {number} [maxWords]
 */

/** The answer text of an item, as a definite string. */
const answerOf = (item) => String(item?.answer ?? "");

/** The question text of an item, as a definite string. */
const questionOf = (item) => String(item?.question ?? "");

/**
 * Index a list into first-in-first-out queues keyed by question text.
 *
 * @param {AnswerItem[]} list
 * @returns {Map<string, string[]>} question text → its answers, in list order.
 */
function queueByQuestion(list) {
  /** @type {Map<string, string[]>} */
  const byText = new Map();
  for (const item of list) {
    const key = questionOf(item);
    const queue = byText.get(key);
    if (queue) queue.push(answerOf(item));
    else byText.set(key, [answerOf(item)]);
  }
  return byText;
}

/**
 * Merge a route response into the list as it stands right now.
 *
 * @param {{sent?: AnswerItem[], current?: AnswerItem[], incoming?: AnswerItem[]}} opts
 *   `sent` is the list as posted, `current` the list as the candidate has it now,
 *   `incoming` what the route returned.
 * @returns {AnswerItem[]} `current`, with drafted text folded into the answers
 *   that have not been touched since the request went out.
 */
export function mergeDraftedAnswers({ sent = [], current = [], incoming = [] }) {
  const asSent = queueByQuestion(sent);
  const drafted = queueByQuestion(incoming);

  return current.map((item) => {
    const key = questionOf(item);
    // `?.shift()` on a missing or exhausted queue is undefined, which is exactly
    // the "no counterpart on that side" case.
    const wasSent = asSent.get(key)?.shift();
    const draft = drafted.get(key)?.shift();
    // Added while the request was in flight, or dropped by the route's own
    // validation. Either way there is nothing to merge and the local entry stands.
    if (wasSent === undefined || draft === undefined) return item;
    // Edited since it was sent. The keystrokes are newer than the response.
    if (answerOf(item) !== wasSent) return item;
    return { ...item, answer: draft };
  });
}

/**
 * Whether two lists hold the same questions with the same answers, in order.
 *
 * Compares only what the report stores. `maxWords` is derived from the question
 * text for the word counter and is never written, so a difference in it must not
 * make a saved report look unsaved.
 *
 * @param {AnswerItem[] | null | undefined} a
 * @param {AnswerItem[] | null | undefined} b
 * @returns {boolean} false whenever either side is absent, so "nothing has been
 *   saved yet" and "the screen has moved on" are the same answer to the caller.
 */
export function sameAnswers(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every(
    (item, i) => questionOf(item) === questionOf(b[i]) && answerOf(item) === answerOf(b[i]),
  );
}
