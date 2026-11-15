import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTaskArgs, runnerEnv, runTask, TASK_ENV } from "../../scripts/scheduled-jobs-task.mjs";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/scheduled-jobs-task.mjs");

// The host's own overrides must not leak into the task under test.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of TASK_ENV) delete env[key];
  return { ...env, ...extra };
}

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-sched-task-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A stand-in runner that reports what it was given on both streams.
function fakeRunner(dir, body) {
  const file = path.join(dir, "runner.mjs");
  fs.writeFileSync(file, body);
  return file;
}

const quiet = { stdout: () => {}, stderr: () => {} };

test("parseTaskArgs splits the carried environment, the log and the runner arguments", () => {
  assert.deepEqual(
    parseTaskArgs(["--env", "CAREER_OPS_ROOT=C:\\data", "--env", "CAREER_OPS_SCHEDULED_JOBS_PATH=a=b.json", "--log", "C:\\data\\x.log", "--job", "abc"]),
    {
      env: { CAREER_OPS_ROOT: "C:\\data", CAREER_OPS_SCHEDULED_JOBS_PATH: "a=b.json" },
      logPath: "C:\\data\\x.log",
      printLogPath: false,
      runnerArgs: ["--job", "abc"],
    },
  );
  assert.equal(parseTaskArgs(["--print-log-path"]).printLogPath, true);
});

test("parseTaskArgs refuses a variable the task does not carry and malformed pairs", () => {
  assert.throws(() => parseTaskArgs(["--env", "PATH=C:\\evil"]), /PATH is not a variable the scan task carries/);
  assert.throws(() => parseTaskArgs(["--env", "=x"]), /--env needs KEY=VALUE/);
  assert.throws(() => parseTaskArgs(["--env"]), /--env needs KEY=VALUE/);
  assert.throws(() => parseTaskArgs(["--log"]), /--log needs a path/);
});

test("runTask sets the carried variables over the task's own, discards stdout and appends stderr to the log", () => {
  withDir((dir) => {
    const runner = fakeRunner(
      dir,
      'process.stdout.write("stdout line\\n");\n' +
        "process.stderr.write(`root=${process.env.CAREER_OPS_ROOT} args=${process.argv.slice(2).join(\",\")}\\n`);\n" +
        "process.exitCode = 3;\n",
    );
    const log = path.join(dir, "logs", "scheduled-jobs.log");
    fs.mkdirSync(path.dirname(log));
    fs.writeFileSync(log, "earlier\n");
    const code = runTask(["--env", "CAREER_OPS_ROOT=/carried", "--log", log, "--job", "abc"], {
      runner,
      env: cleanEnv({ CAREER_OPS_ROOT: "/from-the-task" }),
      ...quiet,
    });
    assert.equal(code, 3);
    assert.equal(fs.readFileSync(log, "utf8"), "earlier\nroot=/carried args=--job,abc\n");
  });
});

test("runnerEnv removes a variable whose carried value is empty, whatever its case", () => {
  assert.deepEqual(
    runnerEnv({ Career_Ops_Root: "C:\\saved", CAREER_OPS_DATA_DIR: "C:\\saved-data", OTHER: "1" }, { CAREER_OPS_ROOT: "", CAREER_OPS_DATA_DIR: "D:\\data" }),
    { CAREER_OPS_DATA_DIR: "D:\\data", OTHER: "1" },
  );
});

test("runTask hands the runner no variable the installer left unset", () => {
  withDir((dir) => {
    const runner = fakeRunner(dir, "process.stderr.write(`root=${process.env.CAREER_OPS_ROOT ?? \"unset\"}\\n`);\n");
    const log = path.join(dir, "scheduled-jobs.log");
    const code = runTask(["--env", "CAREER_OPS_ROOT=", "--log", log], { runner, env: cleanEnv({ CAREER_OPS_ROOT: "/saved" }), ...quiet });
    assert.equal(code, 0);
    assert.equal(fs.readFileSync(log, "utf8"), "root=unset\n");
  });
});

test("--help and -h print the usage and run nothing", () => {
  for (const flag of ["--help", "-h"]) {
    const result = spawnSync(process.execPath, [TASK, flag, "--env", "BOGUS=1"], { encoding: "utf8", env: cleanEnv() });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    assert.match(result.stdout, /--print-log-path/);
  }
});

test("runTask creates the log folder", () => {
  withDir((dir) => {
    const runner = fakeRunner(dir, 'process.stderr.write("boom\\n"); process.exitCode = 1;\n');
    const log = path.join(dir, "new", "folder", "scheduled-jobs.log");
    assert.equal(runTask(["--log", log], { runner, env: cleanEnv(), ...quiet }), 1);
    assert.equal(fs.readFileSync(log, "utf8"), "boom\n");
  });
});

test("runTask logs a runner that fails to load", () => {
  withDir((dir) => {
    const runner = fakeRunner(dir, 'import "./missing-dependency.mjs";\n');
    const log = path.join(dir, "scheduled-jobs.log");
    const code = runTask(["--log", log], { runner, env: cleanEnv(), ...quiet });
    assert.notEqual(code, 0);
    assert.match(fs.readFileSync(log, "utf8"), /missing-dependency\.mjs/);
  });
});

test("runTask logs a node binary it cannot start", () => {
  withDir((dir) => {
    const log = path.join(dir, "scheduled-jobs.log");
    const code = runTask(["--log", log], { runner: path.join(dir, "runner.mjs"), execPath: path.join(dir, "no-such-node"), env: cleanEnv(), ...quiet });
    assert.equal(code, 1);
    assert.match(fs.readFileSync(log, "utf8"), /could not start the runner/);
  });
});

test("runTask writes a bad argument to the log it names", () => {
  withDir((dir) => {
    const log = path.join(dir, "scheduled-jobs.log");
    let stderr = "";
    const code = runTask(["--env", "HOME=/x", "--log", log], { runner: path.join(dir, "unused.mjs"), env: cleanEnv(), stdout: () => {}, stderr: (text) => { stderr += text; } });
    assert.equal(code, 2);
    assert.match(fs.readFileSync(log, "utf8"), /HOME is not a variable the scan task carries/);
    assert.equal(stderr, "");
  });
});

test("--print-log-path names scheduled-jobs.log beside the store the runner uses", () => {
  withDir((dir) => {
    const print = (env) => spawnSync(process.execPath, [TASK, "--print-log-path"], { encoding: "utf8", env: cleanEnv(env) });

    const byRoot = print({ CAREER_OPS_ROOT: dir });
    assert.equal(byRoot.status, 0, byRoot.stderr);
    assert.equal(byRoot.stdout.trim(), path.join(dir, "data", "scheduled-jobs.log"));

    const store = path.join(dir, "elsewhere", "jobs.json");
    const byStore = print({ CAREER_OPS_ROOT: dir, CAREER_OPS_SCHEDULED_JOBS_PATH: store });
    assert.equal(byStore.status, 0, byStore.stderr);
    assert.equal(byStore.stdout.trim(), path.join(dir, "elsewhere", "scheduled-jobs.log"));
  });
});

test("the task runs the real runner on the store the --env root names", () => {
  withDir((dir) => {
    const log = path.join(dir, "data", "scheduled-jobs.log");
    const run = (...args) =>
      spawnSync(process.execPath, [TASK, "--env", `CAREER_OPS_ROOT=${dir}`, "--log", log, ...args], { encoding: "utf8", env: cleanEnv() });

    const idle = run();
    assert.equal(idle.status, 0, fs.existsSync(log) ? fs.readFileSync(log, "utf8") : idle.stderr);
    assert.equal(idle.stdout, "");
    assert.ok(fs.existsSync(path.join(dir, "data", "scheduled-jobs.json")));

    const failed = run("--job", "bad/id");
    assert.equal(failed.status, 1);
    assert.match(fs.readFileSync(log, "utf8"), /Invalid scheduled job identifier\./);
  });
});
