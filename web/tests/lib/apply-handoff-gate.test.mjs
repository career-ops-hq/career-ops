// The handoff decision is what the person can lose an application over: a
// required sponsorship, work-authorization, or compensation answer left blank,
// or a résumé the page said it would attach. These assert that decision and
// the sentence the review screen shows.
//
// Run (from web/): node --test tests/lib/apply-handoff-gate.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { answersByFieldId, handoffDecision, resumeFieldNotice, screeningKind, withoutHandoffGaps } from "../../src/lib/apply/handoff-gate.mjs";

const sponsorship = { id: "visa", type: "select", label: "Will you require visa sponsorship?", required: true };
const salary = { id: "pay", type: "text", label: "Desired salary", required: true };
const resume = { id: "cv", type: "file", label: "Resume/CV", required: false };

function decide(over) {
  return handoffDecision({ fields: [sponsorship], answers: { visa: "No" }, ...over });
}

test("a required sponsorship answer left blank holds the employer form", () => {
  const decision = decide({ answers: { visa: "" } });
  assert.equal(decision.handoff, false);
  assert.equal(decision.gaps.length, 1);
  assert.equal(decision.gaps[0].code, "screening-empty");
  assert.equal(decision.gaps[0].level, "warn");
  assert.equal(
    decision.gaps[0].message,
    "Required sponsorship question is still empty (Will you require visa sponsorship?). Fill it on this page before the employer form opens.",
  );
});

test("whitespace is still an empty sponsorship answer", () => {
  assert.equal(decide({ answers: { visa: "  " } }).handoff, false);
});

test("a stated sponsorship answer lets the employer form open", () => {
  const decision = decide({ answers: { visa: "No" } });
  assert.equal(decision.handoff, true);
  assert.deepEqual(decision.gaps, []);
});

test("identity questions stay out of the gate even when they are required and empty", () => {
  const labels = [
    "Are you a U.S. citizen?",
    "Gender",
    "Race",
    "Disability status",
    "Veteran status",
    "Are you authorized to work on a permanent basis?",
    "Are you a permanent resident?",
  ];
  for (const label of labels) {
    assert.equal(screeningKind(label), null, label);
    const decision = handoffDecision({
      fields: [{ id: "eeo", type: "select", label, required: true }],
      answers: { eeo: "" },
    });
    assert.equal(decision.handoff, true, label);
  }
});

test("salary history is not a compensation question this page fills", () => {
  for (const label of ["Salary history", "Current salary", "Previous compensation history", "Current compensation", "Previous pay", "Last compensation"]) {
    assert.equal(screeningKind(label), null, label);
    const decision = handoffDecision({
      fields: [{ id: "hist", type: "text", label, required: true }],
      answers: { hist: "" },
    });
    assert.equal(decision.handoff, true, label);
  }
});

test("a required compensation answer left blank holds the employer form", () => {
  const decision = handoffDecision({ fields: [salary], answers: { pay: "" } });
  assert.equal(decision.handoff, false);
  assert.match(decision.gaps[0].message, /Required compensation question is still empty \(Desired salary\)/);
});

test("years of experience is not invented and does not hold the form by itself", () => {
  assert.equal(screeningKind("Years of experience"), null);
  const decision = handoffDecision({
    fields: [{ id: "yrs", type: "number", label: "Years of experience", required: true }],
    answers: { yrs: "" },
  });
  assert.equal(decision.handoff, true);
});

test("an optional screening question left blank does not hold the form", () => {
  const decision = handoffDecision({
    fields: [{ ...sponsorship, required: false }],
    answers: { visa: "" },
  });
  assert.equal(decision.handoff, true);
});

test("a screening answer that did not land on the employer form holds the handoff", () => {
  const decision = handoffDecision({
    fields: [salary],
    answers: { pay: "The posted range" },
    unmetLabels: ["Desired salary"],
  });
  assert.equal(decision.handoff, false);
  assert.equal(decision.gaps[0].code, "screening-empty");
});

test("work authorization uses the same hold as sponsorship", () => {
  for (const label of ["Work authorization", "Are you authorised to work in this country?", "Are you legally authorized to work here?", "Are you eligible to work?"]) {
    assert.equal(screeningKind(label), "authorization", label);
    const decision = handoffDecision({
      fields: [{ id: "auth", type: "select", label, required: true }],
      answers: { auth: "" },
    });
    assert.equal(decision.handoff, false, label);
    assert.match(decision.gaps[0].message, /Required work authorization question is still empty/);
  }
});

test("an optional résumé with no resolved file does not hold the form", () => {
  const decision = handoffDecision({
    fields: [resume],
    answers: {},
    cvAttached: false,
    steps: [],
  });
  assert.equal(decision.handoff, true);
});

test("a required résumé with no resolved file holds the form", () => {
  const decision = handoffDecision({
    fields: [{ ...resume, required: true }],
    cvAttached: false,
  });
  assert.equal(decision.handoff, false);
  assert.equal(decision.gaps[0].code, "resume-missing");
  assert.equal(
    decision.gaps[0].message,
    "No tailored CV was resolved for Resume/CV, so nothing will be attached. The employer form stays on this page until a file is attached.",
  );
});

test("a claimed résumé that attached does not hold the form", () => {
  const decision = handoffDecision({
    fields: [resume],
    cvAttached: true,
    steps: [{ fieldId: "cv", ok: true }],
  });
  assert.equal(decision.handoff, true);
});

test("a claimed résumé that failed to attach holds the form", () => {
  const decision = handoffDecision({
    fields: [resume],
    cvAttached: true,
    steps: [{ fieldId: "cv", ok: false }],
  });
  assert.equal(decision.handoff, false);
  assert.match(decision.gaps[0].message, /The tailored CV did not attach to Resume\/CV/);
});

test("a résumé the live form still reports empty holds the form even after an ok step", () => {
  const decision = handoffDecision({
    fields: [{ ...resume, required: true }],
    cvAttached: true,
    steps: [{ fieldId: "cv", ok: true }],
    unmetLabels: ["Resume/CV"],
  });
  assert.equal(decision.handoff, false);
  assert.equal(decision.gaps.filter((gap) => gap.code === "resume-missing").length, 1);
});

test("a cover letter upload is left to the person", () => {
  const decision = handoffDecision({
    fields: [{ id: "letter", type: "file", label: "Cover letter", required: true }],
    cvAttached: false,
  });
  assert.equal(decision.handoff, true);
});

test("the review screen claims a résumé only when a file was resolved", () => {
  const claimed = resumeFieldNotice({ label: "Resume/CV", cvAttached: true });
  assert.equal(claimed.claim, true);
  assert.equal(claimed.text, "Your tailored CV (PDF) will be attached automatically. You can swap it on the real form.");

  const missing = resumeFieldNotice({ label: "Résumé", cvAttached: false });
  assert.equal(missing.claim, false);
  assert.equal(missing.text, "No tailored CV was resolved, so this file will not be attached.");

  const other = resumeFieldNotice({ label: "Portfolio", cvAttached: true });
  assert.equal(other.claim, false);
  assert.equal(other.text, "Attach this file yourself on the real form at the handoff.");
});

test("labeled answers land on field ids, and a blank stays blank", () => {
  const fields = [sponsorship, salary];
  const mapped = answersByFieldId(fields, [
    { label: "Will you require visa sponsorship?", value: "No" },
    { id: "pay", value: "  " },
  ]);
  assert.deepEqual(mapped, { visa: "No", pay: "  " });
  assert.equal(handoffDecision({ fields, answers: mapped }).handoff, false);
});

test("two fields that share a label keep the answer stored on each id", () => {
  const fields = [
    { id: "visa-a", label: "Will you require visa sponsorship?" },
    { id: "visa-b", label: "Will you require visa sponsorship?" },
  ];
  const mapped = answersByFieldId(fields, [
    { id: "visa-a", label: "Will you require visa sponsorship?", value: "No" },
    { id: "visa-b", label: "Will you require visa sponsorship?", value: "" },
  ]);
  assert.deepEqual(mapped, { "visa-a": "No", "visa-b": "" });
});

test("a retry can drop the previous handoff gaps without dropping other issues", () => {
  const next = withoutHandoffGaps([
    { code: "screening-empty", message: "Required sponsorship question is still empty" },
    { code: "resume-missing", message: "The tailored CV did not attach" },
    { code: "fill-mismatch", message: "A field did not match" },
  ]);
  assert.deepEqual(next, [{ code: "fill-mismatch", message: "A field did not match" }]);
  const provider = readFileSync(new URL("../../src/components/apply/apply-provider.tsx", import.meta.url), "utf8");
  assert.equal(provider.split("withoutHandoffGaps(").length - 1, 2);
});
