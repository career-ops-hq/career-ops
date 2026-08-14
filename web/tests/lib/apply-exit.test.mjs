// Tests for the Apply page's two exit decisions (#2734): whether leaving would
// lose work, and where "back" actually goes.
//
// Both are pure functions on purpose. The Apply page is the one screen where a
// wrong answer is expensive: a missing confirmation throws away answers the user
// spent minutes on, and a bad return path sends "Mark applied" somewhere the
// user never was. Neither is observable from a component test, so the decisions
// live here where every branch can be pinned.
//
// Run:  node --test tests/lib/apply-exit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { needsLeaveConfirmation, resolveReturnPath, resolveLateSession, DEFAULT_RETURN_PATH } from "../../src/lib/apply/exit.mjs";

test("needsLeaveConfirmation: no confirm when the form was only glanced at", () => {
  // Given a form that was read but never answered, with nothing running
  const session = { status: "ready", answers: {} };

  // When deciding whether to confirm
  const confirm = needsLeaveConfirmation(session);

  // Then backing out is one click — there is nothing to lose
  assert.equal(confirm, false);
});

test("needsLeaveConfirmation: confirms once any answer has content", () => {
  // Given one drafted answer among empty ones
  const session = { status: "ready", answers: { q1: "", q2: "I led the rebrand." } };

  // When deciding whether to confirm
  const confirm = needsLeaveConfirmation(session);

  // Then leaving is guarded
  assert.equal(confirm, true);
});

test("needsLeaveConfirmation: whitespace-only answers are not work", () => {
  // Given answers containing nothing but whitespace (a stray keystroke)
  const session = { status: "ready", answers: { q1: "   ", q2: "\n\t" } };

  // When deciding whether to confirm
  const confirm = needsLeaveConfirmation(session);

  // Then it still reads as an untouched form
  assert.equal(confirm, false);
});

test("needsLeaveConfirmation: confirms during every in-flight step", () => {
  // Given each status where a step is running that leaving would interrupt
  for (const status of ["opening", "driving", "prefilling", "filling"]) {
    // When deciding whether to confirm, with no answers yet
    const confirm = needsLeaveConfirmation({ status, answers: {} });

    // Then the running step is itself the work worth protecting
    assert.equal(confirm, true, `expected a confirm while ${status}`);
  }
});

test("needsLeaveConfirmation: settled states with no answers do not confirm", () => {
  // Given the statuses where nothing is running
  for (const status of ["idle", "ready", "done", "error"]) {
    // When deciding whether to confirm, with no answers
    const confirm = needsLeaveConfirmation({ status, answers: {} });

    // Then leaving is unguarded
    assert.equal(confirm, false, `did not expect a confirm while ${status}`);
  }
});

test("needsLeaveConfirmation: survives a missing session", () => {
  // Given no session at all (the button renders before state settles)

  // When deciding whether to confirm
  // Then it does not throw, and does not nag
  assert.equal(needsLeaveConfirmation(), false);
  assert.equal(needsLeaveConfirmation({}), false);
});

test("resolveReturnPath: returns the recorded origin", () => {
  // Given the job page the apply session was opened from
  const from = "/jobs/4";

  // When resolving where back goes
  const target = resolveReturnPath(from);

  // Then it goes back to that exact page
  assert.equal(target, "/jobs/4");
});

test("resolveReturnPath: keeps the origin's query and hash", () => {
  // Given an origin carrying the list state the user had filtered to
  const from = "/pipeline?status=Applied#row-4";

  // When resolving where back goes
  const target = resolveReturnPath(from);

  // Then the user lands back on the same filtered view, not a reset one
  assert.equal(target, "/pipeline?status=Applied#row-4");
});

test("resolveReturnPath: falls back when no origin was recorded", () => {
  // Given a session opened by pasting a form URL, which records no origin

  // When resolving where back goes
  // Then it lands on the tracker rather than nowhere
  assert.equal(resolveReturnPath(undefined), DEFAULT_RETURN_PATH);
  assert.equal(resolveReturnPath(""), DEFAULT_RETURN_PATH);
  assert.equal(resolveReturnPath("   "), DEFAULT_RETURN_PATH);
  assert.equal(resolveReturnPath(null), DEFAULT_RETURN_PATH);
});

test("resolveReturnPath: refuses to navigate off the app", () => {
  // Given origins that would leave the local app
  for (const from of ["https://example.com/jobs/4", "//example.com/jobs/4", "javascript:alert(1)", "jobs/4"]) {
    // When resolving where back goes
    const target = resolveReturnPath(from);

    // Then the navigation stays inside career-ops
    assert.equal(target, DEFAULT_RETURN_PATH, `expected ${from} to be refused`);
  }
});

test("resolveReturnPath: refuses to send Apply back to itself", () => {
  // Given an origin that is the Apply page (a reopened session), in the spellings
  // that reach the same route
  for (const from of ["/apply", "/apply?from=/jobs/4", "/apply/", "/apply/#top"]) {
    // When resolving where back goes
    const target = resolveReturnPath(from);

    // Then back is a real exit, not a no-op reload
    assert.equal(target, DEFAULT_RETURN_PATH, `expected ${from} to be refused`);
  }
});

test("resolveLateSession: a result for the session still on screen is applied", () => {
  // Given a session response that came back before the user went anywhere
  const action = resolveLateSession({ stale: false, sessionId: "sess-1" });

  // Then it populates the page as normal
  assert.equal(action, "apply");
});

test("resolveLateSession: a session that opened after the user left is closed", () => {
  // Given the user pressed Back while the form was still opening, and the
  // session came back afterwards carrying a live headless browser
  const action = resolveLateSession({ stale: true, sessionId: "sess-1" });

  // Then it is closed. Dropping the result is not enough: nothing else knows
  // this session exists, so the browser it opened would run until the machine
  // is rebooted.
  assert.equal(action, "close");
});

test("resolveLateSession: a late failure with no session opens nothing to close", () => {
  // Given the user left and the request came back without a session id
  for (const sessionId of [undefined, null, ""]) {
    const action = resolveLateSession({ stale: true, sessionId });

    // Then there is nothing to close, and nothing to apply
    assert.equal(action, "discard", `expected discard for ${JSON.stringify(sessionId)}`);
  }
});

test("resolveReturnPath: a route merely starting with apply is still valid", () => {
  // Given a sibling route whose name shares the /apply prefix
  const from = "/applications";

  // When resolving where back goes
  const target = resolveReturnPath(from);

  // Then it is not mistaken for the Apply page itself
  assert.equal(target, "/applications");
});
