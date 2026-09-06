// Tests for jobErrorHint() using Node's built-in test runner.
// Imports directly from job-error-hint.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/job-error-hint.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { jobErrorHint } from "../../src/lib/job-error-hint.mjs";

/** Build a minimal error job whose terminal step carries `label`. */
function errorJob(label, text = "") {
  return {
    status: "error",
    text,
    steps: [
      { kind: "status", label: "Starting…", ts: 0 },
      { kind: "status", label, ts: 1 },
    ],
  };
}

test("no CLI configured -> auth hint", () => {
  const hint = jobErrorHint(errorJob("No CLI configured — open Config"));
  assert.equal(hint?.kind, "auth");
  assert.equal(hint?.text, "Sign your CLI in from Config, then re-run.");
});

test("raw CLI stderr mentioning auth -> auth hint", () => {
  const hint = jobErrorHint(errorJob("Invalid API key · please run `claude login`"));
  assert.equal(hint?.kind, "auth");
});

test("'is it installed and authenticated?' canned message -> auth hint", () => {
  const hint = jobErrorHint(errorJob("The CLI exited with an error — is it installed and authenticated?"));
  assert.equal(hint?.kind, "auth");
});

test("'no output' canned message -> auth hint", () => {
  const hint = jobErrorHint(
    errorJob("The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)"),
  );
  assert.equal(hint?.kind, "auth");
});

test("a raw 401 unauthorized label -> auth hint", () => {
  assert.equal(jobErrorHint(errorJob("401 unauthorized"))?.kind, "auth");
});

test("'author' in an unrelated terminal label -> NO auth hint (the bug this fixes)", () => {
  // career-ops evaluates AI/tech job postings, so a terminal label can
  // legitimately read something like "Failed to parse author metadata" —
  // a bare "auth" substring matched inside it and produced the sign-in prompt.
  assert.equal(jobErrorHint(errorJob("Failed to parse author metadata")), null);
});

test("authenticate/authentication match the pattern, authority does not", () => {
  assert.equal(jobErrorHint(errorJob("Please authenticate before continuing"))?.kind, "auth");
  assert.equal(jobErrorHint(errorJob("Authentication required"))?.kind, "auth");
  assert.equal(jobErrorHint(errorJob("Missing authority metadata in the JD")), null);
});

test("only the TERMINAL step is classified: an earlier auth label is ignored", () => {
  const job = {
    status: "error",
    text: "",
    steps: [
      { kind: "status", label: "The CLI exited with an error — is it installed and authenticated?", ts: 0 },
      { kind: "status", label: "No report was written", ts: 1 },
    ],
  };
  assert.equal(jobErrorHint(job), null);
});

test("connection error -> connection hint, NOT auth", () => {
  const hint = jobErrorHint(errorJob("Connection error"));
  assert.equal(hint?.kind, "connection");
  assert.equal(hint?.text, "Lost connection to the local server — re-run.");
});

test("page-reload interruption -> interrupted hint, NOT auth", () => {
  const hint = jobErrorHint(errorJob("Interrupted (page reloaded)"));
  assert.equal(hint?.kind, "interrupted");
  assert.equal(hint?.text, "The run was interrupted — re-run it.");
});

test("connection error with unrelated auth-flavored assistant text -> still connection, NOT auth (the bug this fixes)", () => {
  // Accumulated assistant output from a real evaluation routinely mentions
  // "credentials"/"sign-in"/"authenticate" as ordinary JD/CV prose — that
  // must never leak into the terminal-cause classification.
  const text =
    "The candidate holds strong professional credentials and the platform's sign-in flow requires OAuth authentication for API access.";
  const hint = jobErrorHint(errorJob("Connection error", text));
  assert.equal(hint?.kind, "connection");
});

test("interrupted with unrelated auth-flavored assistant text -> still interrupted, NOT auth", () => {
  const text = "This product requires the user to authenticate via SSO login with their corporate credentials.";
  const hint = jobErrorHint(errorJob("Interrupted (page reloaded)", text));
  assert.equal(hint?.kind, "interrupted");
});

test("other terminal errors -> no hint", () => {
  assert.equal(jobErrorHint(errorJob("Failed to start")), null);
  assert.equal(jobErrorHint(errorJob("This needs a complete career-ops checkout (modes/oferta.md).")), null);
  assert.equal(jobErrorHint(errorJob("Add your CV first so I can score this against you — drop it on the home page.")), null);
  assert.equal(
    jobErrorHint(errorJob("This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code.")),
    null,
  );
  assert.equal(
    jobErrorHint(errorJob("This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify.")),
    null,
  );
});

test("running job -> no hint", () => {
  assert.equal(jobErrorHint({ status: "running", text: "", steps: [{ kind: "status", label: "Working", ts: 0 }] }), null);
});

test("done job -> no hint", () => {
  assert.equal(jobErrorHint({ status: "done", text: "", steps: [{ kind: "status", label: "Done", ts: 0 }] }), null);
});

test("error job with no steps -> no hint (defensive)", () => {
  assert.equal(jobErrorHint({ status: "error", text: "", steps: [] }), null);
});
