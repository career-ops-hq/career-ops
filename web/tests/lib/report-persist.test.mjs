// Tests for report-persist.mjs. spawnFn is a fake EventEmitter-based child
// process — no real reserve-report-num.mjs / merge-tracker.mjs is spawned.
//
// Run:  node --test tests/lib/report-persist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
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
import { writeEvaluationArtifacts } from "../../../persist-evaluation-report.mjs";
import { resolveTsvColumns, TSV_ADDITION_HEADER } from "../../../tracker-parse.mjs";

function fakeChild({ stdout = "", stderr = "", exitCode = 0, spawnError = null, onStdin = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let stdinBuf = "";
  child.stdin = {
    write(chunk) {
      stdinBuf += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    },
    end() {},
  };
  queueMicrotask(() => {
    if (spawnError) {
      child.emit("error", spawnError);
      return;
    }
    let out = stdout;
    let err = stderr;
    let code = exitCode;
    if (onStdin) {
      try {
        const produced = onStdin(stdinBuf) || {};
        if (produced.stdout != null) out = produced.stdout;
        if (produced.stderr != null) err = produced.stderr;
        if (produced.exitCode != null) code = produced.exitCode;
      } catch (e) {
        out = "";
        err = e instanceof Error ? e.message : String(e);
        code = 1;
      }
    }
    if (out) child.stdout.emit("data", Buffer.from(out));
    if (err) child.stderr.emit("data", Buffer.from(err));
    child.emit("close", code);
  });
  return child;
}

function makeRouterSpawn(routes) {
  const calls = [];
  const spawnFn = (execPath, args, opts) => {
    const call = { execPath, args, opts, stdin: "" };
    calls.push(call);
    const scriptPath = args[0];
    const route = Object.entries(routes).find(([suffix]) => scriptPath.endsWith(suffix));
    if (!route) throw new Error(`no fake route for ${scriptPath}`);
    const spec = typeof route[1] === "function" ? route[1](args, opts) : route[1];
    const child = fakeChild(spec);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk) => {
      call.stdin += typeof chunk === "string" ? chunk : chunk.toString();
      return write(chunk);
    };
    return child;
  };
  return { spawnFn, calls };
}

function writerSpec(fsImpl) {
  return (_args, opts) => ({
    onStdin(raw) {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return { exitCode: 1, stderr: "stdin is not JSON" };
      }
      const result = writeEvaluationArtifacts(opts.cwd, payload, fsImpl);
      if (!result.ok) return { exitCode: 1, stderr: result.error };
      return { exitCode: 0, stdout: "{\"ok\":true}\n" };
    },
  });
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
  assert.equal(formatScore("9/5"), null);
  assert.equal(formatScore("4/10"), null);
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

function headedRows(text) {
  const lines = text.replace(/\n$/, "").split("\n");
  assert.equal(lines.length, 2, "a tracker addition is a header row and one data row");
  return { header: lines[0].split("\t"), fields: lines[1].split("\t") };
}

test("trackerTsvLine: header names sit on the same cells merge-tracker reads", () => {
  const row = {
    num: "035", today: "2026-08-04", company: "Acme", role: "Eng",
    score: "4.2/5", reportFile: "035-acme-2026-08-04.md", notes: "; posted: 2026-08-01",
    via: "Hays", url: "https://acme.com/jobs/7",
  };
  const { header, fields } = headedRows(trackerTsvLine(row));
  assert.equal(header.slice(0, 9).join("\t"), TSV_ADDITION_HEADER);
  assert.deepEqual(header.slice(9), ["via", "url"]);
  assert.equal(header.length, fields.length);
  const { map, missing, unknown } = resolveTsvColumns(header);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
  assert.equal(fields[map.num], "035");
  assert.equal(fields[map.status], "Evaluated");
  assert.equal(fields[map.score], "4.2/5");
  assert.equal(fields[map.report], "[035](reports/035-acme-2026-08-04.md)");
  assert.equal(fields[map.notes], "; posted: 2026-08-01");
  assert.equal(fields[map.via], "Hays");
  assert.equal(fields[map.url], "https://acme.com/jobs/7");

  const noVia = headedRows(trackerTsvLine({ ...row, via: null }));
  assert.equal(noVia.header.join("\t"), `${TSV_ADDITION_HEADER}\turl`);
  assert.equal(noVia.fields[noVia.header.indexOf("url")], "https://acme.com/jobs/7");
  assert.equal(noVia.header.includes("via"), false);
});

test("persistEvaluation: writes report + TSV, reserves, merges, releases", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  mkdirSync(join(root, "data"));
  const pipeline = `## Pending
- [ ] https://acme.com/jobs/7 | Acme | Engineer
- [ ] https://acme.com/jobs/8 | Acme | Engineer
`;
  writeFileSync(join(root, "data", "pipeline.md"), pipeline);
  writeFileSync(join(root, "pipeline-lock.mjs"), `export { withPipelineLock } from ${JSON.stringify(new URL("../../../pipeline-lock.mjs", import.meta.url).href)};\n`);
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "035\n" },
    "persist-evaluation-report.mjs": writerSpec(),
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
    assert.deepEqual(result.warnings, []);
    assert.equal(readFileSync(join(root, "data", "pipeline.md"), "utf8"), pipeline.replace("- [ ] https://acme.com/jobs/7", "- [x] https://acme.com/jobs/7"));
    assert.equal(existsSync(join(root, "data", "pipeline.md.lock")), false);

    const reportPath = join(root, "reports", "035-acme-ai-2026-08-04.md");
    const tsvPath = join(root, "batch", "tracker-additions", "035-acme-ai.tsv");
    assert.equal(readFileSync(reportPath, "utf8"), REPORT);
    const { header, fields } = headedRows(readFileSync(tsvPath, "utf8"));
    const { map, missing } = resolveTsvColumns(header);
    assert.deepEqual(missing, []);
    assert.equal(fields[map.company], "Acme AI");
    assert.equal(fields[map.status], "Evaluated");
    assert.equal(fields[map.notes], "; posted: 2026-08-01");
    assert.equal(fields[map.url], "https://acme.com/jobs/7");

    const scripts = calls.map((c) => basename(c.args[0]) + (c.args.includes("--release") ? " --release" : ""));
    assert.deepEqual(scripts, [
      "reserve-report-num.mjs",
      "persist-evaluation-report.mjs",
      "merge-tracker.mjs",
      "reserve-report-num.mjs --release",
    ]);
    const writer = calls.find((c) => basename(c.args[0]) === "persist-evaluation-report.mjs");
    const payload = JSON.parse(writer.stdin);
    assert.equal(payload.company, "Acme AI");
    assert.equal(payload.reportFile, "035-acme-ai-2026-08-04.md");
    assert.equal(payload.url, "https://acme.com/jobs/7");
    assert.ok(calls.every((c) => c.opts.cwd === root));
    // No core script inherits the server's console: a stale one kills the
    // child at DLL init on Windows with no output at all (#3809).
    assert.ok(calls.every((c) => c.opts.windowsHide === true), "every persist step launches with windowsHide");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: with a separate checkout, every step runs from it with the data root as cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-data-"));
  const coreRoot = mkdtempSync(join(tmpdir(), "co-evalpersist-code-"));
  writeFileSync(join(coreRoot, "pipeline-lock.mjs"), `export { withPipelineLock } from ${JSON.stringify(new URL("../../../pipeline-lock.mjs", import.meta.url).href)};\n`);
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "035\n" },
    "persist-evaluation-report.mjs": writerSpec(),
    "merge-tracker.mjs": { exitCode: 0 },
  });

  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, coreRoot, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, true);
    const writer = calls.find((c) => basename(c.args[0]) === "persist-evaluation-report.mjs");
    assert.equal(writer.args[0], join(coreRoot, "persist-evaluation-report.mjs"));
    // Every step runs from the data root, so the writer and merge-tracker.mjs
    // resolve the additions folder (and any relative override of it) alike.
    assert.ok(calls.every((c) => c.opts.cwd === root), "every persist step runs with the data root as cwd");
    assert.ok(calls.every((c) => c.args[0].startsWith(coreRoot)), "every persist script comes from the checkout");
    assert.ok(existsSync(join(root, "reports", "035-acme-ai-2026-08-04.md")));
    assert.ok(existsSync(join(root, "batch", "tracker-additions", "035-acme-ai.tsv")));
    assert.equal(existsSync(join(coreRoot, "reports")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(coreRoot, { recursive: true, force: true });
  }
});

test("persistEvaluation: a focused selection is recorded in the report and tracker notes", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-focused-"));
  const { spawnFn } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release") ? { exitCode: 0 } : { exitCode: 0, stdout: "035\n" },
    "persist-evaluation-report.mjs": writerSpec(),
    "merge-tracker.mjs": { exitCode: 0 },
  });
  try {
    const archive = "\n## Job Description (archived verbatim)\n**Evaluation scope:** This is literal posting text.\n";
    const markdown = REPORT.replace("\n\n", "\n\n**Evaluation scope:** Focused — interview.\n\n") + archive;
    const result = await persistEvaluation({ spawnFn, execPath: "node", root, markdown, url: "https://jobs.example.test/7", today: "2026-10-25", evaluationSections: ["summary"] });
    assert.equal(result.ok, true);
    const saved = readFileSync(join(root, "reports", result.reportFile), "utf8");
    assert.match(saved, /\*\*Evaluation scope:\*\* Focused — summary\./);
    assert.equal((saved.match(/\*\*Evaluation scope:/g) || []).length, 2);
    assert.ok(!saved.includes("Focused — interview"));
    assert.ok(saved.includes(archive));
    assert.match(readFileSync(join(root, "batch", "tracker-additions", "035-acme-ai.tsv"), "utf8"), /Focused evaluation: summary/);
    const refused = await persistEvaluation({ spawnFn: () => assert.fail("invalid selections must not reserve a report"), execPath: "node", root, markdown: REPORT, url: "https://jobs.example.test/7", today: "2026-10-25", evaluationSections: ["unknown"] });
    assert.equal(refused.ok, false);
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
  mkdirSync(join(root, "data"));
  const pipeline = "## Pending\n- [ ] https://acme.com/jobs/7 | Acme | Engineer\n";
  writeFileSync(join(root, "data", "pipeline.md"), pipeline);
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "036\n" },
    "persist-evaluation-report.mjs": writerSpec(),
    "merge-tracker.mjs": { exitCode: 1, stderr: "status not canonical" },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /merge-tracker/);
    assert.equal(readFileSync(join(root, "data", "pipeline.md"), "utf8"), pipeline, "an unsuccessful save must leave the discovery pending");
    assert.ok(calls.some((c) => c.args.includes("--release")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: a failed release after a saved report is not success", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 1, stderr: "sentinel stuck" }
      : { exitCode: 0, stdout: "035\n" },
    "persist-evaluation-report.mjs": writerSpec(),
    "merge-tracker.mjs": { exitCode: 0 },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /saved but the sentinel was not released/i);
    assert.match(result.error, /sentinel stuck/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: merge failure and release failure are both reported", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 1, stderr: "sentinel stuck" }
      : { exitCode: 0, stdout: "036\n" },
    "persist-evaluation-report.mjs": writerSpec(),
    "merge-tracker.mjs": { exitCode: 1, stderr: "status not canonical" },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /merge-tracker/);
    assert.match(result.error, /sentinel stuck/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: a tab in the posting URL releases the number and writes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "037\n" },
    "merge-tracker.mjs": { exitCode: 0 },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://evil.com/\tmore", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /tab or newline/i);
    assert.equal(existsSync(join(root, "reports")), false);
    assert.equal(existsSync(join(root, "batch", "tracker-additions")), false);
    assert.ok(calls.some((c) => c.args.includes("--release")));
    assert.equal(calls.some((c) => basename(c.args[0]) === "merge-tracker.mjs"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistEvaluation: a failed addition write removes the new report and releases", async () => {
  const root = mkdtempSync(join(tmpdir(), "co-evalpersist-"));
  const reportPath = join(root, "reports", "035-acme-ai-2026-08-04.md");
  const fsImpl = {
    mkdirSync,
    existsSync,
    unlinkSync,
    writeFileSync(file, data, enc) {
      if (String(file).endsWith(".tsv")) {
        const err = new Error("tracker additions dir is not writable");
        err.code = "EACCES";
        throw err;
      }
      writeFileSync(file, data, enc);
    },
  };
  const { spawnFn, calls } = makeRouterSpawn({
    "reserve-report-num.mjs": (args) => args.includes("--release")
      ? { exitCode: 0 }
      : { exitCode: 0, stdout: "035\n" },
    "persist-evaluation-report.mjs": writerSpec(fsImpl),
    "merge-tracker.mjs": { exitCode: 0 },
  });
  try {
    const result = await persistEvaluation({
      spawnFn, execPath: "node", root, markdown: REPORT,
      url: "https://acme.com/jobs/7", today: "2026-08-04",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /not writable/);
    assert.equal(existsSync(reportPath), false);
    assert.ok(calls.some((c) => c.args.includes("--release")));
    assert.equal(calls.some((c) => basename(c.args[0]) === "merge-tracker.mjs"), false);
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
