// persist-evaluation-report.mjs writes the report and the headed addition.
// It does not reserve a number and it does not merge the tracker.
import { test } from "node:test";
import * as fs from "node:fs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackerTsvLine as coreLine } from "../lib/tracker-addition.mjs";
import { writeEvaluationArtifacts } from "../persist-evaluation-report.mjs";
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';
import { listTree } from '../lib/walk-tree.mjs';

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
    markdown: "# Evaluation: Globex -- Manager\n\nA role.\n\n## Job Description (archived verbatim)\nThe manager owns service delivery, works with product stakeholders, documents requirements, and improves quality with the engineering team.\n",
    ...ROW,
    ...overrides,
  };
}

function tsvWriteFails(real = fs) {
  return {
    ...real,
    openSync(file, flags, mode) {
      if (String(file).endsWith('.tsv')) throw new Error('tracker additions dir is not writable');
      return real.openSync(file, flags, mode);
    },
  };
}


test("persist-evaluation-report --help prints usage and exits 0", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /^Usage:/m);
});

test("persist-evaluation-report -h matches --help", () => {
  const long = spawnSync(process.execPath, [SCRIPT, "--help"], { cwd: ROOT, encoding: "utf8" });
  const short = spawnSync(process.execPath, [SCRIPT, "-h"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(short.status, 0, describeSpawn(short));
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
    assert.equal(result.status, 0, describeSpawn(result));
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
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
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
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
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

test("an existing report collision is refused and the original bytes remain", () => {
  const root = mkdtempSync(join(tmpdir(), "co-persist-report-"));
  const reportPath = join(root, "reports", ROW.reportFile);
  try {
    mkdirSync(join(root, "reports"), { recursive: true });
    writeFileSync(reportPath, "already here\n");
    const result = writeEvaluationArtifacts(root, payload(), tsvWriteFails());
    assert.equal(result.ok, false);
    assert.equal(existsSync(reportPath), true);
    assert.equal(readFileSync(reportPath, "utf8"), "already here\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup ignores ENOENT when the new report is already gone", () => {
  const result = writeEvaluationArtifacts("/tmp/co-persist-enoent", payload(), {
    mkdirSync() {},
    existsSync() { return false; },
    openSync(file) {
      if (String(file).endsWith('.tsv')) throw new Error('tracker additions dir is not writable');
      return 1;
    },
    closeSync() {},
    writeFileSync() {},
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


// The capability handshake is a pure runtime probe, including when its stdin
// stays open. A legacy writer must never receive an unsupported payload key.
test('native --capabilities finishes before stdin or side-effect operations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'co-native-capability-'));
  const preload = join(root, 'forbid-capability-side-effects.mjs');
  const guard = `import fs from 'node:fs';\nimport {syncBuiltinESMExports} from 'node:module';\nconst denied = () => { throw Error('capability side effect forbidden'); };\nfor (const name of ['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','mkdtemp','mkdtempSync','rename','renameSync','unlink','unlinkSync','rm','rmSync','chmod','chmodSync','chown','chownSync']) if (name in fs) fs[name] = denied;\nconst open = fs.openSync; fs.openSync = (file, flags, ...rest) => { if (typeof flags === 'string' ? /[wa+]/.test(flags) : Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))) denied(); return open(file, flags, ...rest); };\nfor (const name of ['writeFile','appendFile','mkdir','mkdtemp','rename','unlink','rm','chmod','chown']) if (name in fs.promises) fs.promises[name] = denied;\nglobalThis.fetch = denied; syncBuiltinESMExports();\n`;
  writeFileSync(preload, guard);
  try {
    const before = listTree(root);
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, SCRIPT, '--capabilities'], {
      cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false, error;
    child.stdout.on('data', data => { stdout = (stdout + data).slice(0, 4096); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(0, 4096); });
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5000);
      child.once('error', value => { error = value; });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    assert.equal(timedOut, false, 'the read-only flag never waits for stdin EOF');
    assert.equal(error, undefined); assert.equal(result.signal, null); assert.equal(result.code, 0, stderr);
    const capabilities = JSON.parse(stdout);
    assert.deepEqual(Object.keys(capabilities).sort(), ['archiveSourcePacketVersions', 'version']);
    assert.equal(capabilities.version, 1);
    assert.ok(JSON.stringify(capabilities.archiveSourcePacketVersions) === '[]' || JSON.stringify(capabilities.archiveSourcePacketVersions) === '[2]');
    assert.deepEqual(listTree(root), before, 'no data directory, sentinel, archive or report is created');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the synchronous writer cannot credit valid inline text with an invalid explicit source packet', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-native-invalid-source-'));
  try {
    const result = writeEvaluationArtifacts(root, payload({ archiveSource: { version: 2 } }));
    assert.equal(result.ok, false);
    assert.match(result.error, /source|adapter/i);
    assert.deepEqual(listTree(root), [], 'invalid supplied provenance never reaches artifact writes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
