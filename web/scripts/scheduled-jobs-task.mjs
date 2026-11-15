#!/usr/bin/env node
// scheduled-jobs-task.mjs — what the Windows Task Scheduler task runs every 15 minutes.
//
//   node web/scripts/scheduled-jobs-task.mjs [--env KEY=VALUE]... --log <path> [runner args]
//   node web/scripts/scheduled-jobs-task.mjs --print-log-path
//
// A Task Scheduler action has no environment block, so the task starts with the
// user's saved environment only. The macOS/Linux installer writes the path
// overrides into the job's shell command; here install-scan-schedule.ps1 passes
// them as --env arguments instead, and this script sets them before it starts
// scheduled-jobs-runner.mjs. The runner runs as a child process with stdout
// discarded and stderr appended to the log, the same as `>/dev/null 2>>log` in the
// shell command, so a runner that fails to load or crashes still leaves a line.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../lib/is-main-module.mjs";
import { getCareerOpsRoot } from "../../path-resolver.mjs";
import { scheduledStorePath } from "../src/lib/scheduled-runner-path.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = path.resolve(SCRIPTS_DIR, "../..");
const RUNNER = path.join(SCRIPTS_DIR, "scheduled-jobs-runner.mjs");

// The same three variables install-scan-schedule.sh carries.
export const TASK_ENV = Object.freeze(["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_SCHEDULED_JOBS_PATH"]);

const USAGE = `Usage:
  node web/scripts/scheduled-jobs-task.mjs [--env KEY=VALUE]... [--log <path>] [runner args]
  node web/scripts/scheduled-jobs-task.mjs --print-log-path

Runs web/scripts/scheduled-jobs-runner.mjs once, as the Windows scan task does.
  --env KEY=VALUE    set CAREER_OPS_ROOT, CAREER_OPS_DATA_DIR or
                     CAREER_OPS_SCHEDULED_JOBS_PATH for the runner;
                     an empty VALUE removes the variable
  --log <path>       append the runner's stderr to this file (stdout is discarded)
  --print-log-path   print scheduled-jobs.log beside the store this shell resolves
  -h, --help         show this help
`;

/**
 * The environment the runner starts with: the task's own, with the carried
 * values on top. An empty carried value removes the variable, so a value saved
 * in the user's environment cannot point the runner at a store the installer
 * did not resolve. Windows matches variable names without regard to case.
 *
 * @param {NodeJS.ProcessEnv} base
 * @param {Record<string, string>} carried
 * @returns {NodeJS.ProcessEnv}
 */
export function runnerEnv(base, carried) {
  const env = { ...base };
  for (const [key, value] of Object.entries(carried)) {
    for (const existing of Object.keys(env)) {
      if (existing.toUpperCase() === key) delete env[existing];
    }
    if (value !== "") env[key] = value;
  }
  return env;
}

/**
 * Split the task's arguments into the carried environment, the log path and the
 * arguments that go on to the runner.
 *
 * @param {string[]} argv
 * @returns {{ env: Record<string, string>, logPath: string | null, printLogPath: boolean, runnerArgs: string[] }}
 */
export function parseTaskArgs(argv) {
  const env = {};
  let logPath = null;
  let printLogPath = false;
  const runnerArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      const pair = argv[++i];
      const eq = pair === undefined ? -1 : pair.indexOf("=");
      if (eq < 1) throw new Error("--env needs KEY=VALUE");
      const key = pair.slice(0, eq);
      if (!TASK_ENV.includes(key)) throw new Error(`--env ${key} is not a variable the scan task carries`);
      env[key] = pair.slice(eq + 1);
    } else if (arg === "--log") {
      logPath = argv[++i];
      if (!logPath) throw new Error("--log needs a path");
    } else if (arg === "--print-log-path") {
      printLogPath = true;
    } else {
      runnerArgs.push(arg);
    }
  }
  return { env, logPath, printLogPath, runnerArgs };
}

/** The log beside the scheduled jobs store, where install-scan-schedule.sh writes too. */
export function taskLogPath() {
  return path.join(path.dirname(scheduledStorePath(getCareerOpsRoot())), "scheduled-jobs.log");
}

/**
 * Run the scheduled jobs runner once and return its exit code.
 *
 * @param {string[]} argv
 * @param {{ runner?: string, execPath?: string, env?: NodeJS.ProcessEnv, stdout?: (text: string) => void, stderr?: (text: string) => void }} [options]
 * @returns {number}
 */
export function runTask(argv, options = {}) {
  const {
    runner = RUNNER,
    execPath = process.execPath,
    env = process.env,
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
  } = options;

  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(USAGE);
    return 0;
  }

  let parsed;
  try {
    parsed = parseTaskArgs(argv);
  } catch (error) {
    // The arguments could not be read, so neither could --log: write where it was named, if anywhere.
    const index = argv.indexOf("--log");
    const message = `scheduled-jobs-task: ${error instanceof Error ? error.message : String(error)}\n`;
    const logPath = index >= 0 ? argv[index + 1] : null;
    if (logPath && appendLog(logPath, message)) return 2;
    stderr(message);
    return 2;
  }

  if (parsed.printLogPath) {
    stdout(`${taskLogPath()}\n`);
    return 0;
  }

  let fd = null;
  if (parsed.logPath) {
    fs.mkdirSync(path.dirname(parsed.logPath), { recursive: true });
    fd = fs.openSync(parsed.logPath, "a");
  }
  try {
    const result = spawnSync(execPath, [runner, ...parsed.runnerArgs], {
      cwd: CODE_ROOT,
      env: runnerEnv(env, parsed.env),
      stdio: ["ignore", "ignore", fd ?? "inherit"],
      windowsHide: true,
    });
    if (result.error) {
      const message = `scheduled-jobs-task: could not start the runner: ${result.error.message}\n`;
      if (fd === null) stderr(message);
      else fs.writeSync(fd, message);
      return 1;
    }
    if (result.status === null) {
      const message = `scheduled-jobs-task: the runner stopped on ${result.signal}\n`;
      if (fd === null) stderr(message);
      else fs.writeSync(fd, message);
      return 1;
    }
    return result.status;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function appendLog(logPath, text) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text);
    return true;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runTask(process.argv.slice(2));
}
