// persist-evaluation-report.mjs writes the report and the headed addition.
// It does not reserve a number and it does not merge the tracker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackerTsvLine as coreLine } from "../lib/tracker-addition.mjs";
import { writeEvaluationArtifacts } from "../persist-evaluation-report.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, "persist-evaluation-report.mjs");

const ROW = {
  num: "035",
  today: "2026-08-04",
  company: "Globex",
  role: "Manager",
  score: "4.2/5",
  reportFile: "035-globex-2026-08-04.md",
  notes: "row from the core writer",
  via: null,
  url: "https://example.com/jobs/2",
};

function payload(overrides = {}) {
  return {
    markdown: "# Evaluation: Globex -- Manager\n\nA role.\n",
    ...ROW,
    ...overrides,
  };
}

function tsvWriteFails(real = { mkdirSync, existsSync, unlinkSync, writeFileSync }) {
  return {
    mkdirSync: real.mkdirSync,
    existsSync: real.existsSync,
    unlinkSync: real.unlinkSync,
    writeFileSync(file, data, enc) {
      if (String(file).endsWith(".tsv")) {
        const err = new Error("tracker additions dir is not writable");
        err.code = "EACCES";
        throw err;
      }
      real.writeFileSync(file, data, enc);
    },
  };
}


test("persist-evaluation-report --help prints usage and exits 0", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage:/m);
});

test("persist-evaluation-report -h matches --help", () => {
  const long = spawnSync(process.execPath, [SCRIPT, "--help"], { cwd: ROOT, encoding: "utf8" });
  const short = spawnSync(process.execPath, [SCRIPT, "-h"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(short.status, 0, short.stderr);
  assert.equal(short.stdout, long.stdout);
});
test("tracker addition builders in lib and web agree", async (t) => {
  // web/ is excluded from core-only installs (#3269). Skip rather than crash.
  if (!existsSync(join(ROOT, "web", "src"))) {
    t.skip("web/ not present");
    return;
  }
  const { trackerTsvLine: webLine } = await import("../web/src/lib/report-persist.mjs");
  const rows = [
    ROW,
    { ...ROW, via: "Hays", url: "https://example.com/jobs/2" },
    { ...ROW, via: null, url: "" },
    { ...ROW, via: "Hays", url: "" },
  ];
  for (const row of rows) {
    assert.equal(coreLine(row), webLine(row));
  }
});

test("the script writes the report and the headed addition", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  try {
    const body = payload();
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      input: JSON.stringify(body),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    assert.equal(readFileSync(join(root, "reports", ROW.reportFile), "utf8"), body.markdown);
    assert.equal(readFileSync(join(root, "batch", "tracker-additions", "035-globex.tsv"), "utf8"), coreLine(ROW));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bad reportFile writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  try {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      input: JSON.stringify(payload({ reportFile: "../secret.md" })),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to write report/);
    assert.equal(existsSync(join(root, "reports")), false);
    assert.equal(existsSync(join(root, "batch")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stdin that is not JSON exits non-zero", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  try {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      input: "not-json",
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSON/);
    assert.equal(existsSync(join(root, "reports")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed addition write removes only the new report", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  const reportPath = join(root, "reports", ROW.reportFile);
  try {
    const result = writeEvaluationArtifacts(root, payload(), tsvWriteFails());
    assert.equal(result.ok, false);
    assert.match(result.error, /not writable/);
    assert.equal(existsSync(reportPath), false);
    assert.equal(existsSync(join(root, "batch", "tracker-additions", "035-globex.tsv")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed addition write leaves a report that already existed", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  const reportPath = join(root, "reports", ROW.reportFile);
  try {
    mkdirSync(join(root, "reports"), { recursive: true });
    writeFileSync(reportPath, "already here\n");
    const result = writeEvaluationArtifacts(root, payload(), tsvWriteFails());
    assert.equal(result.ok, false);
    assert.equal(existsSync(reportPath), true);
    assert.equal(readFileSync(reportPath, "utf8"), payload().markdown);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup ignores ENOENT when the new report is already gone", () => {
  const result = writeEvaluationArtifacts("/tmp/co-persist-enoent", payload(), {
    mkdirSync() {},
    existsSync() { return false; },
    writeFileSync(file) {
      if (String(file).endsWith(".tsv")) {
        const err = new Error("tracker additions dir is not writable");
        err.code = "EACCES";
        throw err;
      }
    },
    unlinkSync() {
      const err = new Error("gone");
      err.code = "ENOENT";
      throw err;
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not writable/);
  assert.doesNotMatch(result.error, /gone/);
});
