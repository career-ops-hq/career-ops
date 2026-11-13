// web-service-ops.mjs — install, uninstall, restart and status of the dashboard as a
// login service, on macOS (launchd), Linux (systemd --user) and Windows (Task
// Scheduler).
//
// Every OS access arrives in `ctx`, so web/tests/lib/web-service-ops.test.mjs drives
// all three platforms from one machine with a recording `run`. The definitions
// themselves are in web-service.mjs.
//
// ctx: {
//   platform, home, xdgConfigHome, uid, user, isRoot, execPath, webDir, env, logPath,
//   tmpDir, fs, run(command, args) -> { status, stdout, stderr }, sleep(ms), out(line)
// }

import path from "node:path";
import {
  SERVICE,
  carriedEnv,
  definitionPath,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderTaskXml,
  runArgs,
  stableNodePath,
} from "./web-service.mjs";

const PLATFORMS = ["darwin", "linux", "win32"];

function unsupported(platform) {
  return new Error(`unsupported platform: ${platform} (macOS, Linux and Windows are supported)`);
}

function describe(result) {
  return (result.stderr || result.stdout || `exit ${result.status}`).trim();
}

/** Everything install needs to know, computed without touching anything. */
function plan(ctx) {
  const { platform, webDir, fs, env } = ctx;
  if (!PLATFORMS.includes(platform)) throw unsupported(platform);
  if (ctx.isRoot) throw new Error("must not run as root: the service belongs to the current user");

  const runner = path.join(webDir, "scripts", "web-service.mjs");
  if (!fs.existsSync(runner)) throw new Error(`runner not found: ${runner}`);
  if (!fs.existsSync(path.join(webDir, "package-lock.json"))) {
    throw new Error(`package-lock.json not found in ${webDir}: the service installs with npm ci`);
  }

  const node =
    platform === "win32"
      ? ctx.execPath
      : stableNodePath(ctx.execPath, {
          exists: (p) => fs.existsSync(p),
          realpath: (p) => fs.realpathSync(p),
        });
  const args = runArgs(runner, carriedEnv(env), platform === "win32" ? { logPath: ctx.logPath } : {});
  const file = definitionPath({ platform, home: ctx.home, xdgConfigHome: ctx.xdgConfigHome });

  let text;
  if (platform === "darwin") {
    text = renderLaunchdPlist({ label: SERVICE.launchdLabel, node, args, workDir: webDir, logPath: ctx.logPath });
  } else if (platform === "linux") {
    text = renderSystemdUnit({ node, args, workDir: webDir });
  } else {
    if (!ctx.user) throw new Error("cannot tell which Windows user to run the task as (USERNAME is not set)");
    text = renderTaskXml({ node, args, workDir: webDir, user: ctx.user });
  }
  return { node, args, file, text };
}

/**
 * Install the service for the current user and start it. Re-running replaces the
 * previous definition. With `dryRun`, prints the definition and changes nothing.
 */
export async function installService(ctx, { dryRun = false } = {}) {
  const { platform, fs, out } = ctx;
  const { file, text } = plan(ctx);

  if (dryRun) {
    out(file ? `# ${file}` : `# Task Scheduler task "${SERVICE.taskName}"`);
    out(text);
    return { file, text, installed: false };
  }

  fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });

  if (platform === "darwin") await installLaunchd(ctx, file, text);
  else if (platform === "linux") installSystemd(ctx, file, text);
  else installTask(ctx, text);
  return { file, text, installed: true };
}

async function installLaunchd(ctx, file, text) {
  const { fs, run, out, sleep } = ctx;
  const label = SERVICE.launchdLabel;
  const domain = `gui/${ctx.uid}`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.writeFileSync(file, text);

  run("launchctl", ["bootout", `${domain}/${label}`]); // not loaded yet is fine
  // bootout can return before launchd drops the old job, so bootstrap is retried briefly.
  let result;
  for (let attempt = 1; attempt <= 5; attempt++) {
    result = run("launchctl", ["bootstrap", domain, file]);
    if (result.status === 0) break;
    if (attempt < 5) await sleep(1000);
  }
  if (result.status !== 0) {
    if (previous === null) {
      fs.rmSync(file, { force: true });
    } else {
      fs.writeFileSync(file, previous);
      run("launchctl", ["bootstrap", domain, file]);
    }
    throw new Error(`launchctl bootstrap failed (a logged-in GUI session is required): ${describe(result)}`);
  }
  out(`Installed ${label} (launchd). It starts at login and restarts if it exits.`);
  out(`Logs: ${ctx.logPath}`);
}

function installSystemd(ctx, file, text) {
  const { fs, run, out } = ctx;
  const unit = SERVICE.systemdUnit;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  for (const args of [["daemon-reload"], ["enable", unit], ["restart", unit]]) {
    const result = run("systemctl", ["--user", ...args]);
    if (result.status !== 0) {
      throw new Error(
        `systemctl --user ${args.join(" ")} failed: ${describe(result)}\n` +
          "A systemd user session is required: log in normally (su and sudo do not start one).",
      );
    }
  }
  out(`Installed ${unit} (systemd --user). It starts at login and restarts if it exits.`);
  out(`Logs: journalctl --user -u ${unit}`);
  out('To start it at boot instead of at login, run once: loginctl enable-linger "$USER"');
}

function installTask(ctx, text) {
  const { fs, run, out } = ctx;
  const name = SERVICE.taskName;
  const file = path.join(ctx.tmpDir, "career-ops-web-task.xml");

  // schtasks reads the definition as UTF-16 with a byte-order mark.
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
  try {
    const created = run("schtasks", ["/Create", "/TN", name, "/XML", file, "/F"]);
    if (created.status !== 0) throw new Error(`schtasks /Create failed: ${describe(created)}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  const started = run("schtasks", ["/Run", "/TN", name]);
  out(`Installed task "${name}" (Task Scheduler). It starts at logon and restarts if it exits.`);
  if (started.status !== 0) out(`It could not be started now (${describe(started)}); it will start at your next logon.`);
  out(`Logs: ${ctx.logPath}`);
}

// A stop command may fail because there was nothing to stop; any other failure means the
// service may still be running, so the definition must stay for another attempt.
function stoppedOrAbsent(result, absentCodes, absentText) {
  return result.status === 0 || absentCodes.includes(result.status) || absentText.test(`${result.stderr}\n${result.stdout}`);
}

// With /HRESULT, schtasks exits with the HRESULT of what went wrong; a task that does not
// exist is ERROR_FILE_NOT_FOUND (0x80070002), reported unsigned or signed by the platform.
// Anything else (access denied, the Task Scheduler service down) is a real failure.
const TASK_NOT_FOUND = [0x80070002, -2147024894];
const taskAbsent = (result) => TASK_NOT_FOUND.includes(result.status);

/** Stop and remove the service. Keeps the log. */
export function uninstallService(ctx) {
  const { platform, fs, run, out } = ctx;
  if (!PLATFORMS.includes(platform)) throw unsupported(platform);
  const file = definitionPath({ platform, home: ctx.home, xdgConfigHome: ctx.xdgConfigHome });

  if (platform === "darwin") {
    const existed = fs.existsSync(file);
    const stopped = run("launchctl", ["bootout", `gui/${ctx.uid}/${SERVICE.launchdLabel}`]);
    if (!stoppedOrAbsent(stopped, [3, 113], /no such process|could not find|not found|not loaded/i)) {
      throw new Error(`launchctl bootout failed, so the definition was kept: ${describe(stopped)}`);
    }
    fs.rmSync(file, { force: true });
    out(existed ? `Removed ${SERVICE.launchdLabel}.` : `${SERVICE.launchdLabel} is not installed.`);
  } else if (platform === "linux") {
    const existed = fs.existsSync(file);
    const stopped = run("systemctl", ["--user", "disable", "--now", SERVICE.systemdUnit]);
    if (!stoppedOrAbsent(stopped, [], /does not exist|not found|not loaded|no such file/i)) {
      throw new Error(`systemctl disable failed, so the unit was kept: ${describe(stopped)}`);
    }
    fs.rmSync(file, { force: true });
    if (existed) run("systemctl", ["--user", "daemon-reload"]);
    out(existed ? `Removed ${SERVICE.systemdUnit}.` : `${SERVICE.systemdUnit} is not installed.`);
  } else {
    const name = SERVICE.taskName;
    const queried = run("schtasks", ["/Query", "/TN", name, "/HRESULT"]);
    if (queried.status !== 0) {
      if (!taskAbsent(queried)) throw new Error(`could not query the task: ${describe(queried)}`);
      out(`Task "${name}" is not installed.`);
      return;
    }
    run("schtasks", ["/End", "/TN", name]);
    const deleted = run("schtasks", ["/Delete", "/TN", name, "/F"]);
    if (deleted.status !== 0) throw new Error(`schtasks /Delete failed: ${describe(deleted)}`);
    out(`Removed task "${name}".`);
  }
}

/**
 * Restart the service, which re-runs the install and build check: this is how a
 * `git pull` or `update-system.mjs apply` reaches the running dashboard.
 */
export function restartService(ctx) {
  const { platform, run, out } = ctx;
  if (!PLATFORMS.includes(platform)) throw unsupported(platform);

  let result;
  if (platform === "darwin") {
    result = run("launchctl", ["kickstart", "-k", `gui/${ctx.uid}/${SERVICE.launchdLabel}`]);
  } else if (platform === "linux") {
    result = run("systemctl", ["--user", "restart", SERVICE.systemdUnit]);
  } else {
    run("schtasks", ["/End", "/TN", SERVICE.taskName]);
    result = run("schtasks", ["/Run", "/TN", SERVICE.taskName]);
  }
  if (result.status !== 0) throw new Error(`restart failed (is the service installed?): ${describe(result)}`);
  out("Restarted. If the code changed since the last start, it is rebuilding first.");
}

/** Print the platform's own account of the service. Returns whether it is installed. */
export function serviceStatus(ctx) {
  const { platform, run, out } = ctx;
  if (!PLATFORMS.includes(platform)) throw unsupported(platform);

  let result;
  let absent = false;
  if (platform === "darwin") {
    result = run("launchctl", ["print", `gui/${ctx.uid}/${SERVICE.launchdLabel}`]);
    absent = result.status === 113 || /could not find|not found/i.test(result.stderr);
  } else if (platform === "linux") {
    result = run("systemctl", ["--user", "status", "--no-pager", SERVICE.systemdUnit]);
    // status exits 3 for a unit that exists but is inactive; only "not found" (4) means absent.
    if (result.status === 3) result = { ...result, status: 0 };
    absent = result.status === 4 || /could not be found|not-found/i.test(result.stderr);
  } else {
    result = run("schtasks", ["/Query", "/TN", SERVICE.taskName, "/FO", "LIST", "/V", "/HRESULT"]);
    absent = taskAbsent(result);
  }
  if (result.status !== 0) {
    if (!absent) throw new Error(`could not query the service: ${describe(result)}`);
    out("Not installed.");
    return false;
  }
  out(result.stdout.trimEnd());
  out(`Logs: ${platform === "linux" ? `journalctl --user -u ${SERVICE.systemdUnit}` : ctx.logPath}`);
  return true;
}
