import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationGateForJob, isLegacyMissingReportMessage, jobStateLabel, jobOutputForDisplay } from "../../src/lib/job-gate.mjs";

const missing = "This evaluation didn't produce a report to save, so it isn't in your tracker — re-run it to verify. (The agent emitted no <<report-md>> envelope, so there is no report to save.)";
const stopped = 'Stopped before Block A.\n\nneeds_confirmation: dealbreaker "location" - rerun with "evaluate anyway" to evaluate\n\nVERDICT: N/A/5 — The role requires residence outside the allowed location.';
const agency = 'Stopped before Block A.\n\n```yaml\nstatus: needs_confirmation\nreason: agency_confirmation\nquestion: "Confirm the intermediary before proceeding."\n```\n\nVERDICT: N/A/5 — Agency confirmation required.';
const job = (text = stopped) => ({ id: "fixture", kind: "evaluate", status: "error", steps: [{ kind: "status", label: missing }], text });

test("old explicit stops gain review context without rewriting their error status or text", () => {
  for (const text of [stopped, agency]) {
    const original = job(text);
    const before = JSON.stringify(original);
    const gate = evaluationGateForJob(original);
    assert.equal(gate?.legacy, true);
    assert.equal(gate.confirmationRequired, true);
    assert.equal(jobStateLabel(original), "Needs review");
    assert.equal(JSON.stringify(original), before);
    assert.equal(original.status, "error");
    assert.equal(original.steps.at(-1).label, missing);
    assert.equal("result" in original, false);
    assert.equal("reportN" in original, false);
  }
});

test("legacy review never conceals transport, CLI or reload failures", () => {
  for (const label of ["Connection error", "Interrupted (page reloaded)", "Codex: Selected model is at capacity.", "Worker exited with error", "No CLI configured"]) {
    const original = job();
    original.steps.unshift({ kind: "status", label });
    assert.equal(evaluationGateForJob(original), null, label);
    assert.equal(jobStateLabel(original), "Failed");
    assert.equal(evaluationGateForJob({ ...job(), steps: [{ kind: "status", label }] }), null);
  }
});

test("ordinary prose, quoted job instructions and unrelated kinds remain genuine errors", () => {
  for (const text of ["The JD mentions dealbreakers and needs_confirmation.", `The posting says:\n> ${stopped.replaceAll("\n", "\n> ")}`, "VERDICT: N/A/5 — Could not load posting."]) {
    assert.equal(evaluationGateForJob(job(text)), null);
  }
  for (const changed of [{ kind: "pdf" }, { status: "running" }, { status: "done" }, { reportN: 7 }, { result: { score: 3.5 } }]) {
    assert.equal(evaluationGateForJob({ ...job(), ...changed }), null);
  }
  assert.equal(isLegacyMissingReportMessage(missing), true);
  assert.equal(isLegacyMissingReportMessage("This evaluation didn't produce a report due to process failure."), false);
});

test("server-confirmed gated jobs stay unscored and have no legacy uncertainty", () => {
  const current = { ...job(), status: "gated", gate: { reason: "agency_confirmation", message: "Confirm the intermediary.", confirmationRequired: true } };
  assert.deepEqual(evaluationGateForJob(current), current.gate);
  assert.equal(jobStateLabel(current), "Needs review");
  assert.equal(evaluationGateForJob({ ...current, gate: { ...current.gate, reason: "unknown" } }), null);
});


test("only validated machine gate blocks are hidden from primary output, with the original retained", () => {
  const text = 'Stopped before scoring.\n<<evaluation-gate>>\n{"status":"needs_confirmation","reason":"dealbreaker","message":"Review the location rule."}\n<</evaluation-gate>>\nVERDICT: N/A/5 — Location rule.';
  const original = { ...job(text), status: "gated", gate: { reason: "dealbreaker", message: "Review the location rule.", confirmationRequired: true } };
  assert.doesNotMatch(jobOutputForDisplay(original), /<<evaluation-gate>>|"status":"needs_confirmation"/);
  assert.match(jobOutputForDisplay(original), /Stopped before scoring/);
  assert.equal(original.text, text);
  assert.equal(jobOutputForDisplay(job(stopped)), stopped, "legacy prose stays available");
  assert.equal(jobOutputForDisplay({ ...original, text: text.replace('"status":"needs_confirmation"', '"status":"invalid"') }), text.replace('"status":"needs_confirmation"', '"status":"invalid"'));
});
