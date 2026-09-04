/**
 * run-outcome.mjs — the honesty gate for a non-pdf /api/run worker (#9).
 *
 * Sibling of pdfRunOutcome in pdf-render.mjs, which does the same job for pdf
 * runs and was extracted for the same reason. This one lives in its own module
 * rather than beside it because pdf-render.mjs is the pdf BACKEND pipeline
 * (write the CV, spawn the renderer, mark the tracker) and an evaluate gate has
 * no business in a file named for rendering PDFs. Read the two together.
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / pdf-render.mjs) so it can be
 * unit-tested with `node --test`, no TypeScript build step, and dependency-free
 * on purpose: it takes five booleans-and-a-string and returns a verdict, so it
 * needs nothing from the route's transport layer.
 *
 * THE RULE, in one sentence: a green "done" — which the client banks as a
 * confident score and which triggers its tracker refresh — requires real output,
 * a CLEAN exit, no error on stderr, and (for a kind that persists) a report file
 * that actually landed. Everything else is surfaced as an error.
 */

/**
 * @typedef {Object} EvaluateRunSignals
 * @property {string|null} noOutputMessage - The route's verdict on "did the CLI
 *   produce any output at all", or null when it did. That question is about the
 *   transport, not this module, so the route owns the wording and passes it in —
 *   the same contract pdfRunOutcome uses, so one condition/message pair serves
 *   both gates.
 * @property {boolean} persists - This kind writes a report file (evaluate).
 * @property {boolean} wroteReport - reports/ actually gained a file during the run.
 * @property {boolean} cleanExit - Exit code 0 (not killed, not non-zero, not a signal).
 * @property {boolean} sawError - Anything error-shaped on stderr.
 * @property {string} [stderrSnippet] - The route's heuristic classification of the
 *   last error-shaped stderr line, when it found one. Appended to arm 4's message
 *   only, and only when !sawError: sawError means the CLI already sent an
 *   authoritative structured error, and a guess layered on top of it is noise.
 */

/**
 * Did this run earn a confident "done"?
 *
 * The five arms, in evaluation order, with the case each one exists for:
 *
 * | # | Condition                             | Case                                        |
 * |---|---------------------------------------|---------------------------------------------|
 * | 1 | noOutputMessage                       | CLI never ran, or is not authenticated      |
 * | 2 | persists && !wroteReport              | Worker ran but never persisted (no Write)   |
 * | 3 | persists && wroteReport && !cleanExit | Cut off AFTER the report landed             |
 * | 4 | !cleanExit \|\| sawError              | Errored, and nothing was supposed to persist |
 * | 5 | otherwise                             | Clean                                       |
 *
 * Arm 3 is the subtlest rule in the route and the reason this is a table rather
 * than a cascade: the kill timer (or any non-zero/signal exit) cut the run off,
 * but the report file had ALREADY been written. Saying "nothing was saved" there
 * would be false, so it stays an error (a half-finished evaluation must never be
 * banked as a confident score) while the wording says what actually happened. The
 * client's refresh only fires on a clean "done", so that report will not appear in
 * the tracker until the page is reloaded — which is why the message says to reload.
 *
 * Arm 4 reads as the catch-all but is NOT reachable for a persisting kind via
 * !cleanExit: arms 2 and 3 have already claimed every !cleanExit path there. Its
 * only persisting route is `wroteReport && cleanExit && sawError` — a clean exit
 * that still logged an error. That is precisely the deduction no reader makes on
 * sight from the inline cascade this replaced.
 *
 * @param {EvaluateRunSignals} signals
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function evaluateRunOutcome({ noOutputMessage, persists, wroteReport, cleanExit, sawError, stderrSnippet }) {
  // A CLI that produced nothing at all is a different failure from one that ran
  // and fell short — usually "not installed" or "not authenticated".
  if (noOutputMessage) return { ok: false, message: noOutputMessage };

  if (persists && !wroteReport) {
    // The worker ran but never wrote the report/tracker row (e.g. a CLI without
    // file-write authorization) — surface it instead of a fake score.
    return {
      ok: false,
      message: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code.",
    };
  }

  if (persists && wroteReport && !cleanExit) {
    return {
      ok: false,
      message: "This run was cut off before it finished, but it had already saved a report. Reload to see it, and re-run if the report looks incomplete.",
    };
  }

  if (!cleanExit || sawError) {
    // Produced output but did NOT finish cleanly — flag it instead of recording a
    // confident score off a half-finished run. Capped at 200 chars because the
    // snippet is a raw stderr line, and the client renders this as a step label.
    const detail = !sawError && stderrSnippet ? ` (${stderrSnippet})` : "";
    return {
      ok: false,
      message: `This run hit an error before finishing, so it isn't recorded as a confident result. Re-run it to verify.${detail}`.slice(0, 200),
    };
  }

  return { ok: true };
}
