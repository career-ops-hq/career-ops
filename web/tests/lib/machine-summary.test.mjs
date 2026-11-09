import test from "node:test";
import assert from "node:assert/strict";
import { cardReason, prepQuestions, readMachineSummary, scoreLevers } from "../../src/lib/machine-summary.mjs";

const report = (yaml) => `# Evaluation: Northwind Labs -- Platform Engineer

**Score:** 3.4/5

## Machine Summary

\`\`\`yaml
${yaml}
\`\`\`

## A) Role Summary
`;

const full = report(`company: "Northwind Labs"
final_decision: "Consider"
hard_stops:
  - "Requires on-site in a city outside the profile"
soft_gaps: []
top_strengths:
  - "Five years of Python services"
score_evidence:
  cv_match: "supported"
  north_star: "partial"
  compensation: "unknown"
  culture: "supported"
  red_flags: "supported"
confidence_gaps:
  - "Confirm the salary band"
requirement_importance:
  - requirement: "Terraform"
    jd_signal: "Terraform at scale"
    evidence: "stated"
    importance: "meaningful"
    match: "missing"
  - requirement: "Kubernetes in production"
    jd_signal: "run Kubernetes"
    evidence: "stated"
    importance: "critical"
    match: "missing"
  - requirement: "Go"
    jd_signal: "Go preferred"
    evidence: "stated"
    importance: "preferred"
    match: "missing"
  - requirement: "On-call leadership"
    jd_signal: null
    evidence: "structural"
    importance: "high"
    match: "partial"
  - requirement: "Python"
    jd_signal: "Python"
    evidence: "stated"
    importance: "critical"
    match: "strong"`);

test("levers list hard stops first, then missing requirements by importance", () => {
  const levers = scoreLevers(readMachineSummary(full));
  assert.deepEqual(levers, {
    holding: [
      { text: "Requires on-site in a city outside the profile", importance: null },
      { text: "Kubernetes in production", importance: "critical" },
      { text: "Terraform", importance: "meaningful" },
    ],
    close: [{ text: "On-call leadership", importance: "high" }],
    verify: ["Confirm the salary band", "Compensation evidence is unknown"],
    strengths: ["Five years of Python services"],
  });
});

test("the decision comes from final_decision", () => {
  assert.equal(readMachineSummary(full).decision, "Consider");
});

test("a report without a Machine Summary has no levers to show", () => {
  assert.equal(readMachineSummary("# Evaluation: Old -- Role\n\n## A) Role Summary\n"), null);
});

test("broken YAML reads as no summary rather than throwing", () => {
  assert.equal(readMachineSummary(report("final_decision: [unclosed")), null);
});

test("requirements with an unknown importance band are dropped", () => {
  const s = readMachineSummary(report(`requirement_importance:
  - requirement: "Rust"
    importance: "essential"
    match: "missing"
  - requirement: "SQL"
    importance: "high"
    match: "missing"`));
  assert.deepEqual(s.requirements, [{ requirement: "SQL", importance: "high", match: "missing" }]);
});

test("a card reason names the call, the top strength, and the top blocker", () => {
  assert.deepEqual(cardReason(full), {
    decision: "Consider",
    plus: "Five years of Python services",
    minus: "Requires on-site in a city outside the profile",
  });
});

test("a card reason falls back to a close call when nothing is missing", () => {
  const r = cardReason(report(`final_decision: "Apply"
requirement_importance:
  - requirement: "Mentoring"
    importance: "high"
    match: "partial"`));
  assert.deepEqual(r, { decision: "Apply", plus: null, minus: "Mentoring" });
});

test("a report without a summary gives no card reason", () => {
  assert.equal(cardReason("# Evaluation: Old -- Role\n"), null);
});

test("a soft gap is a close call when nothing else holds the score down", () => {
  const summary = report(`final_decision: "Apply"
soft_gaps:
  - "Light on people management"
  - "On-call leadership"
requirement_importance:
  - requirement: "On-call leadership"
    importance: "high"
    match: "partial"`);
  assert.deepEqual(scoreLevers(readMachineSummary(summary)).close, [
    { text: "On-call leadership", importance: "high" },
    { text: "Light on people management", importance: null },
  ]);
  assert.equal(cardReason(report(`final_decision: "Apply"
soft_gaps:
  - "Light on people management"`)).minus, "Light on people management");
});

test("a soft gap listed twice is one close call", () => {
  const summary = report(`soft_gaps:
  - "Light on people management"
  - "Light on people management"`);
  assert.deepEqual(scoreLevers(readMachineSummary(summary)).close, [
    { text: "Light on people management", importance: null },
  ]);
});

test("prep questions follow importance and pick the question from the match", () => {
  assert.deepEqual(prepQuestions(readMachineSummary(full)), [
    { requirement: "Kubernetes in production", importance: "critical", match: "missing", question: "The role asks for Kubernetes in production. How would you close that gap?" },
    { requirement: "Python", importance: "critical", match: "strong", question: "Walk me through your strongest example of Python. What was the outcome?" },
    { requirement: "On-call leadership", importance: "high", match: "partial", question: "Where have you used On-call leadership, and how deep did you go?" },
    { requirement: "Terraform", importance: "meaningful", match: "missing", question: "The role asks for Terraform. How would you close that gap?" },
  ]);
});

test("prep questions stop at the limit", () => {
  assert.deepEqual(prepQuestions(readMachineSummary(full), 1).map((q) => q.requirement), ["Kubernetes in production"]);
});

test("a repeated requirement gets one question, from its most important entry", () => {
  const s = readMachineSummary(report(`requirement_importance:
  - requirement: "SQL"
    importance: "meaningful"
    match: "partial"
  - requirement: "SQL"
    importance: "critical"
    match: "missing"`));
  assert.deepEqual(prepQuestions(s).map((q) => [q.requirement, q.importance]), [["SQL", "critical"]]);
});

test("an inherited key is not a valid importance or match", () => {
  const s = readMachineSummary(report(`requirement_importance:
  - requirement: "Rust"
    importance: "constructor"
    match: "missing"
  - requirement: "Go"
    importance: "high"
    match: "__proto__"
  - requirement: "Python"
    importance: "high"
    match: "strong"`));
  assert.deepEqual(s.requirements.map((r) => r.requirement), ["Go", "Python"]);
  assert.deepEqual(prepQuestions(s).map((q) => q.requirement), ["Python"]);
});
