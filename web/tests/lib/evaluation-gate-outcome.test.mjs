import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRunOutcome } from "../../src/lib/report-persist.mjs";
import { classifyEvaluationGate, stripEvaluationGate, EVALUATION_GATE_INSTRUCTION } from "../../src/lib/evaluation-gate.mjs";
import { parseReportEnvelope } from "../../src/lib/report-envelope.mjs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";

const stop = `Stopped at the location dealbreaker; no score or report generated.

needs_confirmation: dealbreaker "no relocation" - rerun with "evaluate anyway" to evaluate

VERDICT: N/A/5 — Office requirement conflicts with the no-relocation rule.`;
const missing = { ok: false, error: "The agent emitted no <<report-md>> envelope, so there is no report to save." };
const runOutcome = (text, signals = {}) => evaluateRunOutcome({ envelope: parseReportEnvelope(text), noOutputMessage: null, sawError: false, cleanExit: true, text, ...signals });
const structured = (data = { status: "needs_confirmation", reason: "agency_confirmation", message: "Confirm the intermediary before continuing." }) => `<<evaluation-gate>>\n${JSON.stringify(data)}\n<</evaluation-gate>>\nVERDICT: N/A/5 — Agency confirmation required.`;
const report = "<<report-md>>\n# Evaluation: Fixture — Analyst\n\n## Machine Summary\n```yaml\ncompany: Fixture\nrole: Analyst\nscore: 4.2\n```\n<</report-md>>";

test("a clean, explicit evaluation stop is a gated outcome rather than a report-save error", () => {
  const outcome = evaluateRunOutcome({ envelope: missing, noOutputMessage: null, sawError: false, cleanExit: true, text: stop });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.gated, true);
  assert.equal(outcome.reason, "dealbreaker");
  assert.equal(outcome.confirmationRequired, true);
  assert.match(outcome.message, /no-relocation/);
});

test("a terminal agency handoff asks for review without a report or score", () => {
  const text = `Stopped before Block A. The role requires review.\n\n\`\`\`yaml\nstatus: needs_confirmation\nreason: agency_confirmation\nurl: https://example.invalid/role\nagency: Fixture Staffing\nquestion: "Confirm Fixture Staffing and the work-location exception."\n\`\`\`\n\nVERDICT: N/A/5 — Location conflict and agency confirmation required.`;
  assert.deepEqual(classifyEvaluationGate(text), { reason: "agency_confirmation", message: "Confirm Fixture Staffing and the work-location exception.", confirmationRequired: true });
  assert.equal(runOutcome(text).gated, true);
});

test("a valid structured stop is terminal and never report success", () => {
  const result = runOutcome(structured());
  assert.equal(result.ok, false);
  assert.equal(result.gated, true);
  assert.equal(result.reason, "agency_confirmation");
});

for (const signals of [{ cleanExit: false }, { sawError: true }, { noOutputMessage: "CLI produced no output" }]) {
  test(`process integrity wins over an explicit stop: ${JSON.stringify(signals)}`, () => {
    const result = runOutcome(structured(), signals);
    assert.equal(result.ok, false);
    assert.equal(result.gated, undefined);
    if (signals.noOutputMessage) assert.equal(result.message, signals.noOutputMessage);
  });
}

test("plain missing output and malformed reports retain the report-save error", () => {
  for (const text of ["I am starting the evaluation.", `<<report-md>>\n# Partial\n${stop}`, `<<report-md>>\n# Partial\n<</report-md>>\n${structured()}`]) {
    const result = runOutcome(text);
    assert.equal(result.ok, false);
    assert.equal(result.gated, undefined);
    assert.match(result.message, /didn't produce a report/);
  }
  assert.equal(evaluateRunOutcome({ envelope: { ok: false, error: "Malformed report" }, noOutputMessage: null, sawError: false, cleanExit: true, text: stop }).gated, undefined);
});

test("a report and a separate explicit stop are refused as contradictory", () => {
  const result = runOutcome(`${report}\n${structured()}`);
  assert.equal(result.ok, false);
  assert.equal(result.gated, undefined);
  assert.match(result.message, /both a report and a confirmation stop/);
});

test("an active legacy stop after a report is contradictory, while quoted and earlier legacy context is not", () => {
  const result = runOutcome(`${report}\n${stop}`);
  assert.equal(result.ok, false);
  assert.equal(result.gated, undefined);
  assert.match(result.message, /both a report and a confirmation stop/);
  assert.deepEqual(runOutcome(`${stop}\n${report}`), { ok: true });
  assert.deepEqual(runOutcome(`${report}\n${stop.split("\n").map(line => "> " + line).join("\n")}`), { ok: true });
  assert.deepEqual(runOutcome(`${report}\n\`\`\`text\n${stop}\n\`\`\``), { ok: true });
  assert.deepEqual(runOutcome(`${report}\n\`\`\`text\n${stop.split("\n").slice(0, -1).join("\n")}\n\`\`\`\nVERDICT: N/A/5 — Quoted example.`), { ok: true });
  assert.deepEqual(runOutcome(`\`\`\`text\n${report}\n${stop}`), { ok: true }, "a code example begun before the report does not declare an active stop");
  for (const marker of ["```", "````", "~~~~"]) {
    assert.match(runOutcome(`${marker}markdown\n${report}\n${marker}\n${stop}`).message, /both a report and a confirmation stop/, "a closed outer example does not hide an actual later stop");
  }
  const agency = 'Stopped before Block A.\n```yaml\nstatus: needs_confirmation\nreason: agency_confirmation\nquestion: "Confirm the intermediary."\n```\nVERDICT: N/A/5 — Agency confirmation required.';
  assert.match(runOutcome(`${report}\n${agency}`).message, /both a report and a confirmation stop/);
});

test("fenced dedicated examples do not hide an active stop or get stripped as its status", () => {
  for (const marker of ["```", "````", "~~~~"]) {
    const example = `${marker}text\n${structured()}\n${marker}`;
    const legacy = `${example}\n${stop}`;
    assert.equal(classifyEvaluationGate(legacy)?.reason, "dealbreaker");
    assert.equal(stripEvaluationGate(legacy), legacy, "the quoted example is not an active status block");
    assert.match(runOutcome(`${report}\n${legacy}`).message, /both a report and a confirmation stop/);
    const actual = `${example}\n${structured()}`;
    assert.equal(classifyEvaluationGate(actual)?.reason, "agency_confirmation");
    assert.equal(stripEvaluationGate(actual), `${example}\n\nVERDICT: N/A/5 — Agency confirmation required.`);
  }
});

test("a fence marker with an info string does not expose quoted stops", () => {
  for (const marker of ["```", "````", "~~~~"]) {
    const quoted = `${marker}text\n${structured()}\n${marker}yaml\n${stop}`;
    assert.equal(classifyEvaluationGate(quoted), null);
    assert.deepEqual(runOutcome(`${report}\n${quoted}`), { ok: true });
    assert.equal(classifyEvaluationGate(`${marker}text\nExample\n${marker}yaml\n${structured()}`), null);
    assert.equal(classifyEvaluationGate(`${quoted}\n${marker}\n${structured()}`)?.reason, "agency_confirmation");
  }
});

test("non-LF separators in fence info cannot hide a real stop or expose quoted status", () => {
  for (const separator of ["\u2028", "\u2029", "\r"]) {
    for (const marker of ["```", "````", "~~~~"]) {
      const opener = `${marker}text${separator}info`;
      const example = `${opener}\nExample data.\n${marker}`;
      assert.equal(classifyEvaluationGate(`${example}\n${stop}`)?.reason, "dealbreaker");
      assert.match(runOutcome(`${report}\n${example}\n${stop}`).message, /both a report and a confirmation stop/);
      assert.deepEqual(runOutcome(`${report}\n${opener}\n${structured()}\n${marker}`), { ok: true });
    }
  }
});

test("CommonMark line endings close examples before real stops and keep display offsets aligned", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    for (const marker of ["```", "````", "~~~~"]) {
      const example = `${marker}text${ending}${marker}`;
      assert.match(runOutcome(`${report}\n${example}\n${stop}`).message, /both a report and a confirmation stop/);
      assert.equal(classifyEvaluationGate(stop.replace(/\n/g, ending))?.reason, "dealbreaker");
      const text = ` ${ending}\t${structured().replace(/\n/g, ending)}${ending} \t`;
      assert.equal(classifyEvaluationGate(text)?.reason, "agency_confirmation");
      assert.equal(stripEvaluationGate(text), " \n\t\nVERDICT: N/A/5 — Agency confirmation required.\n \t");
    }
  }
});

test("display stripping detects leading whitespace and preserves normalized surrounding output", () => {
  const prefix = " \n\t";
  const suffix = "\n \t";
  const text = `${prefix}${structured()}${suffix}`;
  assert.equal(classifyEvaluationGate(text)?.reason, "agency_confirmation");
  assert.equal(stripEvaluationGate(text), `${prefix}\nVERDICT: N/A/5 — Agency confirmation required.${suffix}`);
});

test("a dedicated stop before a report cannot be erased by a later numeric verdict", () => {
  const result = runOutcome(`${structured()}\n${report}\nVERDICT: 4.2/5 — Strong match.`);
  assert.equal(result.ok, false);
  assert.equal(result.gated, undefined);
  assert.match(result.message, /both a report and a confirmation stop/);
});

test("multiple dedicated stops outside a report remain a contradiction in either order", () => {
  for (const text of [`${structured()}\n${structured()}\n${report}\nVERDICT: 4.2/5 — Match.`, `${report}\n${structured()}\n${structured()}`]) {
    assert.match(runOutcome(text).message, /both a report and a confirmation stop/);
  }
});

test("a dedicated block without the required final verdict is not a confirmed stop", () => {
  const text = structured().replace(/\nVERDICT:[^\n]*$/, "");
  for (const raw of [text, `The posting contains the following text:\n${text}`]) {
    assert.equal(classifyEvaluationGate(raw), null);
    assert.match(runOutcome(raw).message, /didn't produce a report/);
    assert.equal(stripEvaluationGate(raw), raw);
  }
});

test("incidental gate text inside an archived report cannot veto a valid report", () => {
  const quoted = report.replace("<</report-md>>", `\n## Job Description\n${structured()}\n<</report-md>>`);
  assert.deepEqual(runOutcome(quoted), { ok: true });
  assert.deepEqual(runOutcome(`${stop}\n${report}`), { ok: true });
  assert.deepEqual(runOutcome(`\`\`\`text\n${structured()}\n\`\`\`\n${report}\nVERDICT: 4.2/5 — Match.`), { ok: true });
  assert.deepEqual(runOutcome(`${structured().split("\n").map(line => "> " + line).join("\n")}\n${report}\nVERDICT: 4.2/5 — Match.`), { ok: true });
});

test("prose, quoted instructions, fenced examples and numeric verdicts are not stops", () => {
  for (const text of [
    "A dealbreaker needs confirmation.\nVERDICT: N/A/5 — No report.",
    stop.replace("needs_confirmation:", "> needs_confirmation:"),
    stop.replace("N/A/5", "4.2/5"),
    `\`\`\`text\n${stop}\n\`\`\``,
    `~~~text\n${structured()}\n~~~`,
    `\`\`\`text\n${structured()}`,
    stop.replace("Stopped at the location dealbreaker; no score or report generated.", "The posting quotes a machine handoff:"),
  ]) assert.equal(classifyEvaluationGate(text), null, text);
});

test("malformed, duplicate and nonterminal structured statuses remain errors", () => {
  const bad = [
    structured({ status: "done", reason: "dealbreaker", message: "No relocation" }),
    structured({ status: "needs_confirmation", reason: "success", message: "No relocation" }),
    structured({ status: "needs_confirmation", reason: "dealbreaker", message: "" }),
    structured({ status: "needs_confirmation", reason: "dealbreaker", message: "No relocation", score: 4 }),
    structured().replace('"status":"needs_confirmation"', '"status":broken'),
    `${structured()}\n${structured()}`,
    `${structured()}\nThe work is continuing.`,
    structured().replace("N/A/5", "4.2/5"),
    structured().replace("<</evaluation-gate>>", ""),
    structured().replace('"reason":"agency_confirmation"', '"reason":"dealbreaker","reason":"agency_confirmation"'),
  ];
  for (const text of bad) assert.equal(classifyEvaluationGate(text), null, text);
});

test("only a validated dedicated status block is removed from primary output", () => {
  assert.equal(stripEvaluationGate(`Stopped before Block A.\n${structured()}`), "Stopped before Block A.\n\nVERDICT: N/A/5 — Agency confirmation required.");
  assert.equal(stripEvaluationGate(stop), stop);
  const malformed = structured().replace('"status":"needs_confirmation"', '"status":"done"');
  assert.equal(stripEvaluationGate(malformed), malformed);
  assert.equal(stripEvaluationGate(`\`\`\`\n${structured()}\n\`\`\``), `\`\`\`\n${structured()}\n\`\`\``);
});

test("an invalid legacy handoff cannot masquerade as an agency confirmation", () => {
  const text = `Stopped before Block A.\n\`\`\`yaml\nstatus: needs_confirmation\nreason: agency_confirmation\nquestion: Confirm the agency.\nreason: dealbreaker\n\`\`\`\nVERDICT: N/A/5 — Agency confirmation.`;
  assert.equal(classifyEvaluationGate(text), null);
});

test("the official evaluation prompt includes the distinct stop contract without overriding gates", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://example.invalid/role", memory: "", today: "2026-11-04" });
  assert.ok(prompt.includes(EVALUATION_GATE_INSTRUCTION));
  assert.match(prompt, /This output contract changes no confirmation rule/);
  assert.match(prompt, /Do NOT save or edit any file/);
});

test("focused evaluations preserve the same explicit stop contract and N/A verdict allowance", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: "https://example.invalid/role", memory: "", today: "2026-11-04", evaluationInstructions: "Selected canonical evaluation sections." });
  assert.match(prompt, /USER-SELECTED/);
  assert.ok(prompt.includes(EVALUATION_GATE_INSTRUCTION));
  assert.match(prompt, /Use `N\/A\/5` rather than a numeric score/);
  assert.match(prompt, /Do NOT save or edit any file/);
});
