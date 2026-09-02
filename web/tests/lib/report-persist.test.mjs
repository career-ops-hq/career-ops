// Tests for report-persist.mjs. spawnFn is a fake EventEmitter-based child
// process — no real reserve-report-num.mjs / merge-tracker.mjs is spawned.
//
// Run:  node --test tests/lib/report-persist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateRunOutcome,
  yamlScalar,
  formatScore,
  parseReportMeta,
  reportSlug,
  trackerTsvLine,
  persistEvaluation,
} from "../../src/lib/report-persist.mjs";

function fakeChild({ stdout = "", stderr = "", exitCode = 0, spawnError = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (spawnError) {
      child.emit("error", spawnError);
      return;
    }
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  });
  return child;
}

function makeRouterSpawn(routes) {
  const calls = [];
  const spawnFn = (execPath, args, opts) => {
    calls.push({ execPath, args, opts });
    const scriptPath = args[0];
    const route = Object.entries(routes).find(([suffix]) => scriptPath.endsWith(suffix));
    if (!route) throw new Error(`no fake route for ${scriptPath}`);
    const spec = typeof route[1] === "function" ? route[1](args) : route[1];
    return fakeChild(spec);
  };
  return { spawnFn, calls };
}

const REPORT = `# Evaluation: Acme AI — Senior Engineer

## Machine Summary
\`\`\`yaml
company: "Acme AI"
role: "Senior Engineer"
score: 4.2
via: null
\`\`\`

## A) Role Summary
A role.`;

test("evaluateRunOutcome: missing envelope fails closed", () => {
  const outcome = evaluateRunOutcome({
    envelope: { ok: false, error: "The agent emitted no <<report-md>> envelope, so there is no report to save." },
    noOutputMessage: null,
    sawError: false,
    cleanExit: true,
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /no <<report-md>> envelope/);
});

test("evaluateRunOutcome: clean envelope is ok", () => {
  const outcome = evaluateRunOutcome({
    envelope: { ok: true, markdown: REPORT },
    noOutputMessage: null,
    sawError: false,
    cleanExit: true,
  });
  assert.equal(outcome.ok, true);
});

test("yamlScalar: reads quoted, bare, and null", () => {
  const block = `company: "Acme AI"\nrole: Engineer\nvia: null\nscore: 4.2\n`;
  assert.equal(yamlScalar(block, "company"), "Acme AI");
  assert.equal(yamlScalar(block, "role"), "Engineer");
  assert.equal(yamlScalar(block, "via"), null);
  assert.equal(yamlScalar(block, "score"), "4.2");
  assert.equal(yamlScalar(block, "missing"), null);
});

test("formatScore: normalizes to X.X/5", () => {
  assert.equal(formatScore("4.2"), "4.2/5");
  assert.equal(formatScore("4.2/5"), "4.2/5");
  assert.equal(formatScore("4"), "4.0/5");
  assert.equal(formatScore("4/5"), "4.0/5");
  assert.equal(formatScore("nope"), null);
  assert.equal(formatScore("9"), null);
  assert.equal(formatScore(""), null);
  assert.equal(formatScore(null), null);
});

test("parseReportMeta: Machine Summary wins; title is fallback", () => {
  const meta = parseReportMeta(REPORT);
  assert.equal(meta.ok, true);
  assert.equal(meta.company, "Acme AI");
  assert.equal(meta.role, "Senior Engineer");
  assert.equal(meta.score, "4.2/5");
  assert.equal(meta.via, null);
});

test("parseReportMeta: title fallback when YAML omits company/role", () => {
  const md = `# Evaluation: Globex -- Analyst

## Machine Summary
\`\`\`yaml
score: 3.5
\`\`\`
`;
  const meta = parseReportMeta(md);
  assert.equal(meta.ok, true);
  assert.equal(meta.company, "Globex");
  assert.equal(meta.role, "Analyst");
  assert.equal(meta.score, "3.5/5");
});

test("parseReportMeta: missing score fails", () => {
  const md = `# Evaluation: Acme — Role

## Machine Summary
\`\`\`yaml
company: Acme
role: Role
\`\`\`
`;
  const meta = parseReportMeta(md);
  assert.equal(meta.ok, false);
  assert.match(meta.error, /score/i);
});

test("parseReportMeta: tab in company fails closed", () => {
  const md = REPORT.replace('company: "Acme AI"', 'company: "Acme\tInjected"');
  const meta = parseReportMeta(md);
  assert.equal(meta.ok, false);
  assert.match(meta.error, /tab or newline in company/i);
});

test("parseReportMeta: tab in via fails closed", () => {
  const md = REPORT.replace("via: null", 'via: "Hays\tExtra"');
  const meta = parseReportMeta(md);
  assert.equal(meta.ok, false);
  assert.match(meta.error, /tab or newline in via/i);
});

test("reportSlug: confidential marker for unknown employer", () => {
  assert.equal(reportSlug("Acme AI", null), "acme-ai");
  assert.equal(reportSlug("?", null), "confidential");
  assert.equal(reportSlug("?", "Hays"), "confidential-hays");
  assert.equal(reportSlug("???", null), "company");
});

test("trackerTsvLine: 10 fields, url last, via tagged when present", () => {
  const line = trackerTsvLine({
    num: "035", today: "2026-08-04", company: "Acme", role: "Eng",
    score: "4.2/5", reportFile: "035-acme-2026-08-04.md", notes: "; posted: 2026-08-01",
    via: "Hays", url: "https://acme.com/jobs/7",
  }).trimEnd();
  const fields = line.split("\t");
  assert.equal(fields[0], "035");
  assert.equal(fields[4], "Evaluated");
  assert.equal(fields[5], "4.2/5");
  assert.equal(fields[7], "[035](reports/035-acme-2026-08-04.md)");
  assert.equal(fields[8], "; posted: 2026-08-01");
  assert.equal(fields[9], "via=Hays");
  assert.equal(fields[10], "https://acme.com/jobs/7");
});

test("persistEvaluation: writes report + TSV, reserves, merges, releases", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "035\n" },
    "merge-tracker.mjs": { exitCode: 0 },
  });

  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04", postedAt: "2026-08-01",
    });
    assert.equal(result.ok, true);
    assert.equal(result.num, "035");
    assert.equal(result.reportFile, "035-acme-ai-2026-08-04.md");

    const reportPath = join(root, "reports", "035-acme-ai-2026-08-04.md");
    const tsvPath = join(root, "batch", "tracker-additions", "035-acme-ai.tsv");
    assert.equal(readFileSync(reportPath, "utf8"), REPORT);
    const tsv = readFileSync(tsvPath, "utf8").trimEnd().split("\t");
    assert.equal(tsv[2], "Acme AI");
    assert.equal(tsv[4], "Evaluated");
    assert.equal(tsv[8], "; posted: 2026-08-01");
    assert.equal(tsv[9], "https://acme.com/jobs/7");

    const scripts = calls.map((c) => basename(c.args[0]) + (c.args.includes("--release") ? " --release" : ""));
    assert.deepEqual(scripts, ["reserve-report-num.mjs", "merge-tracker.mjs", "reserve-report-num.mjs --release"]);
    assert.ok(calls.every((c) => c.opts.cwd === root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: tab in company does not reserve or write a TSV", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": { exitCode: 0, stdout: "035\n" },
    "merge-tracker.mjs": { exitCode: 0 },
  });
  const hostile = REPORT.replace('company: "Acme AI"', 'company: "Acme\tInjected"');
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: hostile,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /tab or newline/i);
    assert.equal(calls.length, 0);
    assert.equal(existsSync(join(root, "reports")), false);
    assert.equal(existsSync(join(root, "batch", "tracker-additions")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: reserve failure does not write files", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn } = makeRouterSpawn({
    "reserve-report-num.mjs": { exitCode: 1, stderr: "lock timeout" },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /lock timeout/);
    assert.equal(existsSync(join(root, "reports")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: merge failure still releases the sentinel", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "036\n" },
    "merge-tracker.mjs": { exitCode: 1, stderr: "status not canonical" },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /merge-tracker/);
    assert.ok(calls.some((c) => c.args.includes("--release")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: refuses a non-ISO today rather than joining it into a path", async () => {
  const { spawnFn } = makeRouterSpawn({});
  const result = await persistEvaluation({
    spawnFn, execPath: "node", root: "/tmp", markdown: REPORT,
    url: "https://acme.com/jobs/7", today: "../etc",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid evaluation date/);
});
