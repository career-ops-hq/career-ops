// Tests for run-outcome.mjs using Node's built-in test runner.
//
// evaluateRunOutcome is the honesty gate for every non-pdf /api/run kind: it
// decides whether the stream ends with a green "done" (which the client banks as
// a confident score and which fires its tracker refresh) or with an error. It was
// an inline five-arm cascade in the route, where the truth table was implicit and
// nobody could exercise it. The five arms are covered here individually, plus the
// two deductions the cascade shape hid.
//
// Imports directly from run-outcome.mjs (the single source of truth) so the test
// and production code can never drift out of sync. Nothing is spawned and nothing
// touches the filesystem: this function takes five signals and returns a verdict.
//
// Run:  node --test tests/lib/run-outcome.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRunOutcome } from "../../src/lib/run-outcome.mjs";

// A clean, successful, persisting run. Each test overrides only the signals it is
// about, so a new signal added to the function cannot silently make these pass for
// the wrong reason.
const CLEAN = Object.freeze({
  noOutputMessage: null,
  persists: true,
  wroteReport: true,
  cleanExit: true,
  sawError: false,
});

/** @param {Partial<typeof CLEAN>} overrides */
const outcome = (overrides) => evaluateRunOutcome({ ...CLEAN, ...overrides });

// The exact strings the route used to send inline. The client and the user both
// read these, so they are pinned verbatim rather than matched loosely — one of
// them (arm 3) was corrected for accuracy and must not silently regress.
const MSG = Object.freeze({
  noReport: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code.",
  cutOffAfterSave: "This run was cut off before it finished, but it had already saved a report. Reload to see it, and re-run if the report looks incomplete.",
  errored: "This run hit an error before finishing, so it isn't recorded as a confident result. Re-run it to verify.",
});

// ── Arm 1: no output at all ──────────────────────────────────────────────────

test("arm 1: the route's no-output message wins over every other signal", () => {
  // Given a CLI that produced nothing (not installed / not authenticated), the
  // route hands the wording in — this module must not restate or override it.
  const msg = "The CLI produced no output. Is it installed and authenticated? (career-ops is best on Claude Code.)";
  assert.deepEqual(outcome({ noOutputMessage: msg }), { ok: false, message: msg });
});

test("arm 1: it wins even on an otherwise-perfect run", () => {
  // Given every other signal is green, no output is still a failed run: the
  // arm ordering, not just the condition, is what is under test here.
  const msg = "The CLI exited with an error. Is it installed and authenticated?";
  assert.deepEqual(
    outcome({ noOutputMessage: msg, persists: false, cleanExit: true, sawError: false }),
    { ok: false, message: msg },
  );
});

test("arm 1: an empty-string message is not a failure", () => {
  // Given the route's noOutputError() returns null for "there was output". An
  // empty string is the same statement, and must not be read as a failure with a
  // blank reason — the one outcome a user can do nothing with.
  assert.deepEqual(outcome({ noOutputMessage: "" }), { ok: true });
});

// ── Arm 2: persisted nothing ─────────────────────────────────────────────────

test("arm 2: a persisting run that wrote no report is an error, not a score", () => {
  // Given the worker ran and exited cleanly, but reports/ never gained a file
  // (e.g. a CLI with no file-write authorization silently no-ops).
  assert.deepEqual(outcome({ wroteReport: false }), { ok: false, message: MSG.noReport });
});

test("arm 2: it precedes the generic error arm", () => {
  // Given a run that both failed to persist AND exited dirty, the specific
  // "didn't save a report" reason is the useful one.
  assert.deepEqual(
    outcome({ wroteReport: false, cleanExit: false, sawError: true }),
    { ok: false, message: MSG.noReport },
  );
});

test("arm 2: does not fire for a kind that persists nothing", () => {
  // Given research/fix-portal, wroteReport is meaningless — reports/ is not their
  // output, so a false here must not be read as a missing artifact.
  assert.deepEqual(outcome({ persists: false, wroteReport: false }), { ok: true });
});

// ── Arm 3: cut off, but the report had already landed ────────────────────────

test("arm 3: cut off AFTER the report landed says so, and still errors", () => {
  // Given the kill timer (or any non-zero/signal exit) ended the run, but the
  // report file was already on disk. "Nothing was saved" would be false; a clean
  // "done" would bank a half-finished evaluation as a confident score. Both are
  // wrong, so this is an error whose wording tells the truth and says to reload.
  const result = outcome({ cleanExit: false });
  assert.deepEqual(result, { ok: false, message: MSG.cutOffAfterSave });
  // The reload instruction is the load-bearing half: the client only refreshes on
  // a clean "done", so without it the user never sees the report that did land.
  assert.match(result.message, /Reload to see it/);
});

test("arm 3: fires regardless of stderr noise", () => {
  // Given the same cut-off-after-save case with an error line on stderr, the
  // report still landed, so the generic arm-4 wording would understate it.
  assert.deepEqual(outcome({ cleanExit: false, sawError: true }), { ok: false, message: MSG.cutOffAfterSave });
});

test("arm 3: is persist-only — a dirty non-persisting run gets the generic error", () => {
  // Given research exits dirty: there is no report, so nothing was saved and the
  // "it had already saved a report" wording would be a lie.
  assert.deepEqual(
    outcome({ persists: false, wroteReport: false, cleanExit: false }),
    { ok: false, message: MSG.errored },
  );
});

// ── Arm 4: errored, nothing more specific to say ─────────────────────────────

test("arm 4: a non-persisting run that exits dirty is an error", () => {
  assert.deepEqual(outcome({ persists: false, cleanExit: false }), { ok: false, message: MSG.errored });
});

test("arm 4: a non-persisting run that logged an error is an error despite a clean exit", () => {
  assert.deepEqual(outcome({ persists: false, sawError: true }), { ok: false, message: MSG.errored });
});

test("arm 4: for a persisting kind its ONLY route is wroteReport && cleanExit && sawError", () => {
  // This is the deduction the inline cascade hid. Arms 2 and 3 between them claim
  // every !cleanExit path a persisting kind can take, so the only way a persisting
  // run reaches arm 4 is a CLEAN exit that nonetheless logged an error. Asserted
  // by enumeration rather than by argument, so reordering the arms breaks it.
  const reached = [];
  for (const wroteReport of [true, false]) {
    for (const cleanExit of [true, false]) {
      for (const sawError of [true, false]) {
        const result = outcome({ persists: true, wroteReport, cleanExit, sawError });
        if (!result.ok && result.message === MSG.errored) reached.push({ wroteReport, cleanExit, sawError });
      }
    }
  }
  assert.deepEqual(reached, [{ wroteReport: true, cleanExit: true, sawError: true }]);
});

// ── Arm 5: clean ─────────────────────────────────────────────────────────────

test("arm 5: a clean persisting run that wrote its report is ok", () => {
  assert.deepEqual(outcome({}), { ok: true });
});

test("arm 5: a clean non-persisting run is ok", () => {
  assert.deepEqual(outcome({ persists: false, wroteReport: false }), { ok: true });
});

test("arm 5: ok carries no message, so a caller cannot send an error on a success", () => {
  // The route branches on outcome.ok and reads .message only in the false case;
  // a message on a success would be a trap for the next caller.
  assert.equal("message" in outcome({}), false);
});

// ── Whole-table properties ───────────────────────────────────────────────────

test("every signal combination yields exactly one of the five known verdicts", () => {
  // No input reaches a sixth outcome, and none returns undefined or an
  // {ok:false} with an empty message — a stream ending with neither a usable
  // error nor a done is the failure this gate exists to prevent.
  const KNOWN = new Set([MSG.noReport, MSG.cutOffAfterSave, MSG.errored, "no-output-probe"]);
  for (const noOutputMessage of [null, "no-output-probe"]) {
    for (const persists of [true, false]) {
      for (const wroteReport of [true, false]) {
        for (const cleanExit of [true, false]) {
          for (const sawError of [true, false]) {
            const label = JSON.stringify({ noOutputMessage, persists, wroteReport, cleanExit, sawError });
            const result = evaluateRunOutcome({ noOutputMessage, persists, wroteReport, cleanExit, sawError });
            assert.ok(result && typeof result.ok === "boolean", `no verdict for ${label}`);
            if (result.ok) continue;
            assert.ok(KNOWN.has(result.message), `unknown message for ${label}: ${result.message}`);
          }
        }
      }
    }
  }
});

test("a clean run is the ONLY ok verdict", () => {
  // cleanExit && !sawError && (report landed, if this kind writes one) — stated
  // as an independent predicate so a future arm cannot widen "ok" unnoticed.
  for (const persists of [true, false]) {
    for (const wroteReport of [true, false]) {
      for (const cleanExit of [true, false]) {
        for (const sawError of [true, false]) {
          const expected = cleanExit && !sawError && (!persists || wroteReport);
          const result = evaluateRunOutcome({ noOutputMessage: null, persists, wroteReport, cleanExit, sawError });
          assert.equal(
            result.ok,
            expected,
            `ok mismatch for ${JSON.stringify({ persists, wroteReport, cleanExit, sawError })}`,
          );
        }
      }
    }
  }
});

test("no message blames the user's setup when the run simply errored", () => {
  // Regression guard on tone/accuracy: only arm 1 (which the route words) may
  // talk about installation or authentication. Arms 2-4 describe THIS run.
  for (const message of [MSG.noReport, MSG.cutOffAfterSave, MSG.errored]) {
    assert.doesNotMatch(message, /installed|authenticated/i);
  }
});
