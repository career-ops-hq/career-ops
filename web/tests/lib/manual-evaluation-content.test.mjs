import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { codexStreamArgs } from "../../src/lib/run-cli-support.mjs";
import { loadManualEvaluationSources, parseManualEvaluationJson, persistManualEvaluation, validateManualEvaluationContent } from "../../src/lib/manual-evaluation.mjs";
import { manualJobInputForWorker } from "../../src/lib/manual-jobs.mjs";

const job = { company: "Example", title: "Senior Engineer", description: "Build supported Java services.", url: "https://example.test/job", location: "US Remote", compensation: "$180k" };
const report = `# Evaluation: Example — Senior Engineer

**Date:** 2026-08-28
**URL:** https://example.test/job
**Score:** 4.2/5

## Machine Summary
\`\`\`yaml
company: "Example"
role: "Senior Engineer"
score: 4.2
final_decision: "Apply"
\`\`\`

## A) Role Summary
This is a sufficiently detailed role summary grounded in the supplied posting and profile facts.

## B) Match with CV
Strong documented Java and backend alignment, with explicit distinctions for adjacent experience and gaps.

## C) Red Flags
No unsupported experience is inferred; missing requirements remain genuine gaps.

## D) CV Customization
Emphasize supported backend, API, performance, and production ownership evidence.

## E) Interview Plan
Prepare system-design, reliability, debugging, and cross-functional delivery examples.

## F) Verdict
Apply because the supported technical and role-family evidence is strong.

## G) Posting Legitimacy
The supplied posting content is internally consistent; live status remains based on its supplied source.

## Risk Summary
Compensation and any unstated requirements require confirmation before applying.
`;
const valid = { company: "Example", role: "Senior Engineer", location: "US Remote", compensation: "$180k", score: 4.2, recommendation: "Apply", trackerNote: "Strong backend alignment", reportMarkdown: report, verdictReason: "Strong supported backend fit" };
const sources = {
  "modes/_shared.md": "SHARED RULES",
  "modes/oferta.md": "AUTHORITATIVE OFERTA RULES",
  "cv.md": "MASTER CV FACTS",
  "config/profile.yml": "PROFILE CONFIG",
  "modes/_profile.md": "PROFILE RULES",
};

test("content-only manual prompt supplies JD, CV/profile, and authoritative oferta rules without skill execution", () => {
  const prompt = buildPrompt({ kind: "evaluate", input: manualJobInputForWorker(job), memory: "", today: "2026-08-28", manualEvaluationSources: sources });
  assert.match(prompt, /CONTENT-ONLY MANUAL JOB EVALUATION/);
  assert.match(prompt, /Build supported Java services/);
  assert.match(prompt, /MASTER CV FACTS/);
  assert.match(prompt, /PROFILE CONFIG/);
  assert.match(prompt, /PROFILE RULES/);
  assert.match(prompt, /AUTHORITATIVE OFERTA RULES/);
  assert.match(prompt, /Do not invoke skills or tools/);
  assert.match(prompt, /Do not run Bash/);
  assert.doesNotMatch(prompt, /reserve-report-num\.mjs|merge-tracker\.mjs|Read .*cv\.md/);
});

test("native manual Codex worker is read-only, stdin-only, schema-constrained, and has no project add-dir", () => {
  const args = codexStreamArgs("private", "evaluate", { promptViaStdin: true, isolatedWorkerCwd: "C:/Temp/worker", readOnlyWorker: true, outputSchema: "C:/schema.json", outputLastMessage: "C:/final.json" });
  assert.deepEqual(args, ["exec", "--json", "--color", "never", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--cd", "C:/Temp/worker", "--skip-git-repo-check", "--output-schema", "C:/schema.json", "--output-last-message", "C:/final.json", "-"]);
  assert.equal(args.includes("private"), false);
  assert.equal(args.includes("--add-dir"), false);
});

test("strict structured manual content validates and control wrappers fail", () => {
  assert.equal(validateManualEvaluationContent(valid).ok, true);
  assert.match(validateManualEvaluationContent({ status: "ok", message: "done" }).error, /unexpected field "status"/);
  assert.match(parseManualEvaluationJson("not json").error, /valid structured/);
  assert.match(validateManualEvaluationContent({ ...valid, reportMarkdown: "short" }).error, /incomplete/);
});

test("native manual output schema is strict and requires every declared field", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("../../src/lib/manual-evaluation.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
});

test("fixed source loader reads only approved Career-Ops sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sources-"));
  try {
    for (const [relative, value] of Object.entries(sources)) {
      const file = path.join(root, ...relative.split("/")); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
    }
    const loaded = loadManualEvaluationSources(root);
    assert.deepEqual(Object.keys(loaded).sort(), Object.keys(sources).sort());
    assert.equal(loaded["cv.md"], "MASTER CV FACTS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("backend persistence reserves, writes canonical report/TSV, merges, verifies, and releases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-persist-"));
  try {
    fs.mkdirSync(path.join(root, "reports"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "applications.md"), "# Applications Tracker\n\n| # | Date | Company | Role | Status | Score | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n");
    const calls = [];
    const runNode = (_root, script, args) => {
      calls.push([script, ...args]);
      if (script === "reserve-report-num.mjs" && !args.length) return "007\n";
      if (script === "merge-tracker.mjs") {
        const row = fs.readFileSync(path.join(root, "batch", "tracker-additions", "007-example.tsv"), "utf8");
        fs.appendFileSync(path.join(root, "data", "applications.md"), `| ${row.trim().split("\t").join(" | ")} |\n`);
      }
      return "";
    };
    const result = persistManualEvaluation({ root, today: "2026-08-28", job, content: valid, runNode });
    assert.equal(result.reportNum, "007");
    assert.equal(fs.readFileSync(result.reportPath, "utf8"), report);
    const tsv = fs.readFileSync(path.join(root, "batch", "tracker-additions", "007-example.tsv"), "utf8");
    assert.match(tsv, /^007\t2026-08-28\tExample\tSenior Engineer\tEvaluated\t4\.2\/5\t❌\t\[007\]\(reports\/007-example-2026-08-28\.md\)/);
    assert.deepEqual(calls.map((call) => call[0]), ["reserve-report-num.mjs", "merge-tracker.mjs", "reserve-report-num.mjs"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
