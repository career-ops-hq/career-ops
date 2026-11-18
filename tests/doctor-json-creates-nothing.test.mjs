// tests/doctor-json-creates-nothing.test.mjs — `doctor --json` is a read-only
// diagnosis, and this pins that it stays one.
//
// On `main`, `--json` prints `onboardingState()` and exits before `main()` runs,
// so the data-skeleton checks are never reached and nothing is created. That is
// the behaviour AGENTS.md documents for the flag, and the value of this test is
// that it keeps being true: the skeleton creation lives in `checkAutoDir()` and
// `checkPipelineFile()`, which `main()` calls, so wiring any of them into the
// JSON path would start writing during a diagnosis. This case notices.
//
// The child runs with `CAREER_OPS_PIPELINE` cleared and its data root inside a
// temporary directory, so neither an inherited override nor a developer's own
// files can decide the result. A `--json` run that exits non-zero fails the test
// rather than passing as "nothing was created".
//
// Run:  node --test tests/doctor-json-creates-nothing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Run the real doctor against `dataRoot`, returning its exit code and stdout.
 *
 * @param {string} dataRoot
 * @param {string[]} args
 */
function runDoctor(dataRoot, args) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  // A developer's own pipeline override would point the run at a real file.
  delete env.CAREER_OPS_PIPELINE;
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, "doctor.mjs"), ...args], {
      cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || "") };
  }
}

test('--json leaves an empty data root untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-json-ro-"));
  try {
    const { code, stdout } = runDoctor(dir, ["--json"]);
    assert.equal(code, 0, `doctor --json must succeed, it exited ${code}: ${stdout.slice(0, 400)}`);

    const after = readdirSync(dir).sort();
    assert.deepEqual(after, [], `--json created: ${after.join(", ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a plain run still creates the data skeleton', () => {
  // The control: the read-only promise belongs to `--json`, and the interactive
  // run keeps creating what it always created. The exit code is not asserted
  // here, because a bare data root legitimately reports missing setup.
  const dir = mkdtempSync(join(tmpdir(), "doctor-plain-"));
  try {
    runDoctor(dir, []);
    const after = readdirSync(dir).sort();
    assert.ok(after.includes("data"), `a plain run should still create data/ (saw: ${after.join(", ")})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});