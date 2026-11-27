#!/usr/bin/env node
// web-service.mjs — run the dashboard as a login service of the current user.
//
//   node web/scripts/web-service.mjs install [--dry-run]
//   node web/scripts/web-service.mjs uninstall | restart | status
//
// macOS gets a launchd LaunchAgent, Linux a systemd user unit, Windows a Task
// Scheduler task. All three run `run` below, which installs dependencies and builds
// only when the lockfile, the Node runtime or the checkout changed (see
// src/lib/web-service-prepare.mjs) and then starts `server.mjs start`, so the
// loopback-only default bind and CAREER_OPS_WEB_ALLOWED_HOSTS behave exactly as they
// do for `npm start`.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkTree } from "../../lib/walk-tree.mjs";
import { getCareerOpsRoot } from "../../path-resolver.mjs";
import { scheduledStorePath } from "../src/lib/scheduled-runner-path.mjs";
import {
  installService,
  restartService,
  serviceStatus,
  uninstallService,
} from "../src/lib/web-service-ops.mjs";
import {
  FAILURE_BACKOFF_MS,
  npmInvocation,
  prepareService,
  sourceFingerprint,
  untrackedSignature,
  walkSignature,
} from "../src/lib/web-service-prepare.mjs";
import { crashRestartDelayMs, parseRunArgs } from "../src/lib/web-service.mjs";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webDir, "..");

const USAGE = `Usage: node web/scripts/web-service.mjs <command>

  install [--dry-run]  Install the dashboard as a login service and start it.
                       --dry-run prints the service definition and changes nothing.
  uninstall            Stop and remove the service (keeps the log).
  restart              Restart it; rebuilds first if the code changed.
  status               Show the service's state.
`;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function context() {
  const isWindows = process.platform === "win32";
  // The log sits beside the scheduled-jobs store, like scheduled-jobs.log.
  const logPath = path.join(path.dirname(scheduledStorePath(getCareerOpsRoot())), "web-service.log");
  return {
    platform: process.platform,
    home: os.homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    uid: process.getuid?.(),
    isRoot: process.getuid?.() === 0,
    user: isWindows && process.env.USERNAME ? `${process.env.USERDOMAIN ?? os.hostname()}\\${process.env.USERNAME}` : undefined,
    execPath: process.execPath,
    webDir,
    env: process.env,
    logPath,
    tmpDir: os.tmpdir(),
    fs,
    run,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    out: (line) => console.log(line),
  };
}

// The service entry point. Not meant to be typed by hand: the service manager runs it.
async function runService(argv) {
  const { env: carried, logPath } = parseRunArgs(argv);
  const env = { ...process.env, ...carried };
  // A service has a near-empty PATH; npm's `#!/usr/bin/env node` needs node on it.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = [path.dirname(process.execPath), env[pathKey]].filter(Boolean).join(path.delimiter);

  // A Windows scheduled task has no console, so its output is discarded unless the
  // runner writes it somewhere itself. launchd and systemd already capture it.
  let fd = null;
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fd = fs.openSync(logPath, "a");
  }
  const stdio = fd === null ? ["ignore", "inherit", "inherit"] : ["ignore", fd, fd];
  const log = (line) => {
    const text = `[${new Date().toISOString()}] career-ops web service: ${line}\n`;
    if (fd === null) process.stderr.write(text);
    else fs.writeSync(fd, text);
  };

  const git = (args) => {
    const result = spawnSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout : null;
  };
  const npm = npmInvocation({ platform: process.platform, execPath: process.execPath, exists: fs.existsSync });
  const runNpm = (args) => {
    const result = spawnSync(npm.command, [...npm.prefix, ...args], {
      cwd: webDir,
      env,
      stdio,
      shell: npm.shell,
      windowsHide: true,
    });
    if (result.error) log(`could not run npm: ${result.error.message}`);
    return result.status;
  };

  try {
    prepareService({
      webDir,
      runtime: `${process.version} ${process.platform} ${process.arch}`,
      env,
      fs,
      fingerprint: () =>
        sourceFingerprint({
          git,
          walk: () => walkSignature({ fs, walkTree, repoRoot }),
          untracked: () => untrackedSignature({ fs, git, repoRoot }),
        }),
      runNpm,
      log,
    });
  } catch (err) {
    log(`${err.message}. Waiting ${FAILURE_BACKOFF_MS / 60000} minutes before exiting, so it is not retried at once.`);
    await new Promise((resolve) => setTimeout(resolve, FAILURE_BACKOFF_MS));
    process.exit(1);
  }

  let stopping = false;
  let current = null;
  let restartTimer = null;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
      stopping = true;
      // Stopped while waiting out a crash delay: no child is running, so leave now.
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
        process.exit(128 + (os.constants.signals[signal] ?? 0));
      }
      current?.kill(signal);
    });
  }
  const start = () => {
    restartTimer = null;
    if (stopping) return;
    log("starting the dashboard");
    current = spawn(process.execPath, [path.join(webDir, "server.mjs"), "start"], {
      cwd: webDir,
      env,
      stdio,
      windowsHide: true,
    });
    current.on("error", (err) => {
      log(`could not start the dashboard: ${err.message}`);
      process.exit(1);
    });
    // A signalled child reports a null code; 128+signal keeps a stop distinguishable from a crash.
    current.on("exit", (code, signal) => {
      const delay = crashRestartDelayMs({ platform: process.platform, code, signal, stopping });
      if (delay !== null) {
        log(`the dashboard exited with code ${code}; restarting in ${delay / 1000} seconds`);
        restartTimer = setTimeout(start, delay);
        return;
      }
      process.exit(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 1));
    });
  };
  start();
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "run") {
    await runService(rest);
  } else if (command === "install") {
    const unknown = rest.filter((arg) => arg !== "--dry-run");
    if (unknown.length) throw Object.assign(new Error(`unknown argument: ${unknown[0]}`), { usage: true });
    await installService(context(), { dryRun: rest.includes("--dry-run") });
  } else if (command === "uninstall" || command === "restart" || command === "status") {
    if (rest.length) throw Object.assign(new Error(`unknown argument: ${rest[0]}`), { usage: true });
    const ctx = context();
    if (command === "uninstall") uninstallService(ctx);
    else if (command === "restart") restartService(ctx);
    else if (!serviceStatus(ctx)) process.exitCode = 3;
  } else if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
  } else {
    process.stderr.write(USAGE);
    process.exit(2);
  }
} catch (err) {
  console.error(`web-service: ${err.message}`);
  if (err.usage) process.stderr.write(USAGE);
  process.exit(err.usage ? 2 : 1);
}
