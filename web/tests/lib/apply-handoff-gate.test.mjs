// The handoff decision is what the person can lose an application over: a
// required sponsorship, work-authorization, or compensation answer left blank,
// or a résumé the page said it would attach. These assert that decision and
// the sentence the review screen shows.
//
// Run (from web/): node --test tests/lib/apply-handoff-gate.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { answersByFieldId, answersForRefreshedFields, handoffDecision, issuesAfterAgent, issuesAfterFill, mergeIssues, replaceRequiredEmpty, resumeFieldNotice, screeningKind, withoutHandoffGaps } from "../../src/lib/apply/handoff-gate.mjs";

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
    "No tailored CV was resolved for Resume/CV, so nothing will be attached. Open the report in another tab and choose Generate tailored CV, then retry filling here. The employer form stays on this page until a file is attached.",
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

test("a refreshed field list does not keep an answer on a reused positional id", () => {
  const before = [
    { id: "co0", label: "Name", nativeId: "name" },
    { id: "co1", label: "Office", nativeId: "office" },
  ];
  const after = [
    { id: "co0", label: "Department", nativeId: "dept" },
    { id: "co1", label: "Name", nativeId: "name" },
    { id: "co2", label: "Office", nativeId: "office" },
  ];
  const mapped = answersForRefreshedFields(before, after, [
    { id: "co0", label: "Name", value: "Ada" },
    { id: "co1", label: "Office", value: "Springfield" },
  ]);
  assert.deepEqual(mapped.answers, { co1: "Ada", co2: "Springfield" });
  assert.deepEqual(mapped.dropped, []);
});

test("a shared label with no DOM id stays unmatched after the field list changes", () => {
  const before = [
    { id: "co0", label: "Phone" },
    { id: "co1", label: "Phone" },
  ];
  const after = [
    { id: "co0", label: "Team" },
    { id: "co1", label: "Phone" },
    { id: "co2", label: "Phone" },
  ];
  const mapped = answersForRefreshedFields(before, after, [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "222" },
  ]);
  assert.deepEqual(mapped.answers, {});
  assert.deepEqual(mapped.dropped, ["Phone", "Phone"]);
});

test("same-label controls that swap follow their DOM id", () => {
  const before = [
    { id: "co0", label: "Phone", nativeId: "home" },
    { id: "co1", label: "Phone", nativeId: "mobile" },
  ];
  const after = [
    { id: "co0", label: "Phone", nativeId: "mobile" },
    { id: "co1", label: "Phone", nativeId: "home" },
  ];
  const mapped = answersForRefreshedFields(before, after, [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "222" },
  ]);
  assert.deepEqual(mapped.answers, { co0: "222", co1: "111" });
  assert.deepEqual(mapped.dropped, []);
});

test("same-label controls keep their answers when the DOM id is unchanged", () => {
  const fields = [
    { id: "co0", label: "Phone", nativeId: "home" },
    { id: "co1", label: "Phone", nativeId: "mobile" },
  ];
  const mapped = answersForRefreshedFields(fields, fields.map((field) => ({ ...field })), [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "" },
  ]);
  assert.deepEqual(mapped.answers, { co0: "111", co1: "" });
  assert.deepEqual(mapped.dropped, []);
});

test("same-label controls that share a DOM name stay unverified", () => {
  const fields = [
    { id: "co0", label: "Phone", nativeName: "phones[]" },
    { id: "co1", label: "Phone", nativeName: "phones[]" },
  ];
  const mapped = answersForRefreshedFields(fields, fields.map((field) => ({ ...field })), [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "222" },
  ]);
  assert.deepEqual(mapped.answers, {});
  assert.deepEqual(mapped.dropped, ["Phone", "Phone"]);
});

test("a unique DOM name still keeps a shared label on its control", () => {
  const fields = [
    { id: "co0", label: "Phone", nativeName: "home" },
    { id: "co1", label: "Phone", nativeName: "mobile" },
  ];
  const mapped = answersForRefreshedFields(fields, fields.map((field) => ({ ...field })), [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "222" },
  ]);
  assert.deepEqual(mapped.answers, { co0: "111", co1: "222" });
  assert.deepEqual(mapped.dropped, []);
});

test("same-label controls with no DOM id stay unverified", () => {
  const fields = [
    { id: "co0", label: "Phone" },
    { id: "co1", label: "Phone" },
  ];
  const mapped = answersForRefreshedFields(fields, fields, [
    { id: "co0", label: "Phone", value: "111" },
    { id: "co1", label: "Phone", value: "222" },
  ]);
  assert.deepEqual(mapped.answers, {});
  assert.deepEqual(mapped.dropped, ["Phone", "Phone"]);
});

test("two answers that land on one field are both left unverified", () => {
  const before = [{ id: "co0", label: "Name", nativeId: "name" }];
  const after = [{ id: "co1", label: "Name", nativeId: "name" }];
  const mapped = answersForRefreshedFields(before, after, [
    { id: "co0", label: "Name", value: "Ada" },
    { id: "extra", label: "Name", value: "Bea" },
  ]);
  assert.deepEqual(mapped.answers, {});
  assert.deepEqual(mapped.dropped, ["Name", "Name"]);
});

test("an answer whose field is gone is named instead of dropped quietly", () => {
  const fields = [{ id: "name", label: "Name" }];
  const mapped = answersForRefreshedFields(fields, fields, [
    { id: "name", label: "Name", value: "Ada" },
    { id: "gone", label: "Nickname", value: "A" },
  ]);
  assert.deepEqual(mapped.answers, { name: "Ada" });
  assert.deepEqual(mapped.dropped, ["Nickname"]);
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

test("a retry replaces a stale required-empty warning and keeps unrelated issues", () => {
  const previous = [
    { code: "required-empty", message: "Required and still empty: Visa sponsorship" },
    { code: "fill-mismatch", message: "A field did not match" },
  ];
  assert.deepEqual(replaceRequiredEmpty(previous, []), [
    { code: "fill-mismatch", message: "A field did not match" },
  ]);
  assert.deepEqual(replaceRequiredEmpty(previous, [
    { code: "required-empty", message: "Required and still empty: Phone" },
    { code: "fill-mismatch", message: "A field did not match" },
  ]), [
    { code: "fill-mismatch", message: "A field did not match" },
    { code: "required-empty", message: "Required and still empty: Phone" },
  ]);
});

test("a retry can drop the previous handoff gaps without dropping other issues", () => {
  const next = withoutHandoffGaps([
    { code: "screening-empty", message: "Required sponsorship question is still empty" },
    { code: "resume-missing", message: "The tailored CV did not attach" },
    { code: "fill-mismatch", message: "A field did not match" },
  ]);
  assert.deepEqual(next, [{ code: "fill-mismatch", message: "A field did not match" }]);
});

test("one unmet label holds every required field that shares it", () => {
  const fields = [
    { id: "visa-a", type: "select", label: "Will you require visa sponsorship?", required: true },
    { id: "visa-b", type: "select", label: "Will you require visa sponsorship?", required: true },
  ];
  const decision = handoffDecision({
    fields,
    answers: { "visa-a": "No", "visa-b": "No" },
    unmetLabels: ["Will you require visa sponsorship?"],
  });
  assert.equal(decision.handoff, false);
  assert.equal(decision.gaps.length, 2);
  assert.deepEqual(decision.gaps.map((gap) => gap.field), [
    "Will you require visa sponsorship?",
    "Will you require visa sponsorship?",
  ]);
});

test("a finished fill replaces the last gaps and a stopped agent fill does not add an ai-filled note", () => {
  const previous = [
    { code: "screening-empty", message: "Required sponsorship question is still empty" },
    { code: "resume-missing", message: "old résumé gap" },
    { code: "fill-mismatch", message: "A field did not match" },
  ];
  assert.deepEqual(issuesAfterFill(previous, [
    { code: "required-empty", message: "Required and still empty: Phone" },
    { code: "resume-missing", message: "No tailored CV was resolved for Resume/CV." },
  ]), [
    { code: "fill-mismatch", message: "A field did not match" },
    { code: "required-empty", message: "Required and still empty: Phone" },
    { code: "resume-missing", message: "No tailored CV was resolved for Resume/CV." },
  ]);
  assert.deepEqual(issuesAfterAgent(previous, {
    gaps: [{ code: "resume-missing", message: "new résumé gap" }],
  }), [
    { code: "fill-mismatch", message: "A field did not match" },
    { code: "resume-missing", message: "new résumé gap" },
  ]);
  const note = "AI filled the form for you — review every answer on the real form, then submit it yourself.";
  assert.deepEqual(issuesAfterAgent([
    ...previous,
    { code: "ai-filled", message: note },
  ], {
    gaps: [{ code: "cv-resolve", message: "Could not resolve the résumé." }],
    note,
  }), [
    { code: "fill-mismatch", message: "A field did not match" },
    { code: "ai-filled", message: note },
    { code: "cv-resolve", message: "Could not resolve the résumé." },
  ]);
});

test("a retry keeps one ai-filled note and both résumé gaps", () => {
  const previous = [
    { code: "ai-filled", message: "AI filled the form for you — review every answer on the real form, then submit it yourself." },
    { code: "resume-missing", message: "No tailored CV was resolved for Resume/CV." },
  ];
  const incoming = [
    { code: "resume-missing", message: "No tailored CV was resolved for Resume/CV." },
    { code: "resume-missing", message: "No tailored CV was resolved for Cover letter." },
    { code: "ai-filled", message: "AI filled the form for you — review every answer on the real form, then submit it yourself." },
    { code: "ai-filled", message: "AI filled the form again." },
  ];
  assert.deepEqual(mergeIssues(previous, incoming), [
    previous[0],
    previous[1],
    { code: "resume-missing", message: "No tailored CV was resolved for Cover letter." },
  ]);
});
