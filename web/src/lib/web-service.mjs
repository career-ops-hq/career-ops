// web-service.mjs — what the OS is told when the dashboard is installed as a login
// service: the service definitions for launchd, systemd --user and Task Scheduler,
// and the small decisions behind them (which node binary to pin, which environment
// to carry across).
//
// Pure on purpose: no file, process or OS call lives here, so every definition is
// asserted on any platform by web/tests/lib/web-service.test.mjs. The side effects
// are in web-service-ops.mjs (install/uninstall) and web-service-prepare.mjs
// (install and build gating), both of which take their OS access as arguments.

import path from "node:path";

export const SERVICE = Object.freeze({
  launchdLabel: "io.career-ops.web",
  systemdUnit: "career-ops-web.service",
  taskName: "career-ops web",
});

// launchd, systemd and Task Scheduler all restart a crashed service immediately
// unless told otherwise. A broken build would then spin; 30 seconds matches what
// the scheduled-scan agent and a hand-written KeepAlive agent use.
export const RESTART_SECONDS = 30;

// Task Scheduler's RestartOnFailure interval cannot be shorter than one minute, so on
// Windows the runner does the 30-second throttling itself: it restarts a crashed
// dashboard after RESTART_SECONDS and only exits (leaving the task's own one-minute
// restart as the backstop) for a stop request. Other platforms throttle in the
// definition (ThrottleInterval, RestartSec).
export function crashRestartDelayMs({ platform, code, signal, stopping }) {
  if (platform !== "win32" || stopping || signal || code === 0) return null;
  return RESTART_SECONDS * 1000;
}

// The only environment a service carries. A service starts with a near-empty
// environment, so an override the user exported when installing (a data root kept
// outside the checkout, a port) would otherwise be lost and the dashboard would
// read a different store than the CLI. Nothing else is forwarded: the allow-list is
// enforced again where the arguments are parsed, so a service definition cannot
// smuggle in an arbitrary variable.
export const CARRIED_ENV = Object.freeze([
  "CAREER_OPS_ROOT",
  "CAREER_OPS_DATA_DIR",
  "CAREER_OPS_SCHEDULED_JOBS_PATH",
  "CAREER_OPS_TRACKER",
  "CAREER_OPS_PROFILE",
  "CAREER_OPS_CODE_ROOT",
  "CAREER_OPS_WEB_ALLOWED_HOSTS",
  "PORT",
]);

/**
 * The carried variables that are set in `env`, in CARRIED_ENV order.
 *
 * A value with a line break, a NUL or a double quote is refused rather than escaped:
 * the same value has to survive an XML plist, a systemd unit and a Windows command
 * line, and no path or host name a person means to use contains one.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<[string, string]>}
 */
export function carriedEnv(env) {
  const pairs = [];
  for (const key of CARRIED_ENV) {
    const value = env[key];
    if (value === undefined || value === "") continue;
    if (/[\r\n\0"]/.test(value)) {
      throw new Error(`${key} must not contain a line break or a double quote`);
    }
    pairs.push([key, value]);
  }
  return pairs;
}

/**
 * Arguments after `node` for the service process: the runner script, the `run`
 * command, and one `--env KEY=VALUE` per carried variable.
 *
 * The environment travels as arguments rather than in the service definition
 * because Task Scheduler has no environment block for an action; one mechanism for
 * all three platforms keeps the definitions the same shape and the tests short.
 *
 * @param {string} runner  absolute path to web/scripts/web-service.mjs
 * @param {Array<[string, string]>} env
 * @param {{ logPath?: string }} [options]  logPath: where the runner writes its own
 *   log (Windows only — a scheduled task has no console, so stdout is discarded)
 */
export function runArgs(runner, env, { logPath } = {}) {
  const args = [runner, "run"];
  for (const [key, value] of env) args.push("--env", `${key}=${value}`);
  if (logPath) args.push("--log", logPath);
  return args;
}

/**
 * Parse the `--env` and `--log` arguments of the `run` command.
 *
 * @param {string[]} argv  everything after `run`
 * @returns {{ env: Record<string, string>, logPath: string | null }}
 */
export function parseRunArgs(argv) {
  const env = {};
  let logPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      const pair = argv[++i];
      const eq = pair === undefined ? -1 : pair.indexOf("=");
      if (eq < 1) throw new Error("--env needs KEY=VALUE");
      const key = pair.slice(0, eq);
      if (!CARRIED_ENV.includes(key)) throw new Error(`--env ${key} is not a variable the service carries`);
      env[key] = pair.slice(eq + 1);
    } else if (arg === "--log") {
      logPath = argv[++i];
      if (!logPath) throw new Error("--log needs a path");
    } else {
      throw new Error(`unknown argument for run: ${arg}`);
    }
  }
  return { env, logPath };
}

/**
 * The node binary to write into the service definition.
 *
 * A Homebrew binary resolves to a path that names its version
 * (.../Cellar/node/26.12.1_1/bin/node) and `brew upgrade` deletes that folder, so a
 * service pinned to it would fail with "no such file" after the next upgrade. The
 * opt symlink (.../opt/node/bin/node) follows the current version; it is used when
 * it points at the same binary. Version-manager shims and per-shell paths do not
 * survive a reboot at all, which is why callers pass process.execPath rather than
 * whatever `node` happens to resolve to.
 *
 * @param {string} execPath  process.execPath
 * @param {{ exists: (p: string) => boolean, realpath: (p: string) => string }} fs
 */
export function stableNodePath(execPath, { exists, realpath }) {
  const match = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(execPath.replaceAll("\\", "/"));
  if (!match) return execPath;
  const [, prefix, formula] = match;
  const stable = `${prefix}/opt/${formula}/bin/node`;
  try {
    if (exists(stable) && realpath(stable) === realpath(execPath)) return stable;
  } catch {
    // An unreadable link is not worth failing an install over; the real path still works today.
  }
  return execPath;
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The launchd LaunchAgent. RunAtLoad starts it at login, KeepAlive restarts it when
 * it exits, and ThrottleInterval spaces the restarts out.
 */
export function renderLaunchdPlist({ label, node, args, workDir, logPath }) {
  const argv = [node, ...args].map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>${RESTART_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

// systemd splits an ExecStart line on whitespace, honours C-style quoting inside
// double quotes, and expands %specifiers and $variables, so each of those has to be
// neutralised in a value that came from a path.
const systemdQuote = (s) =>
  `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

/**
 * The systemd user unit. Output goes to the journal (`journalctl --user -u
 * career-ops-web`), which is where a Linux user looks first.
 */
export function renderSystemdUnit({ node, args, workDir }) {
  const exec = [node, ...args].map(systemdQuote).join(" ");
  return `[Unit]
Description=career-ops web dashboard (loopback only unless CAREER_OPS_WEB_ALLOWED_HOSTS is set)

[Service]
Type=simple
WorkingDirectory=${String(workDir).replace(/%/g, "%%")}
ExecStart=${exec}
Restart=always
RestartSec=${RESTART_SECONDS}

[Install]
WantedBy=default.target
`;
}

// Windows command lines treat a space as a separator, so an argument that has one
// is wrapped in quotes. The values were already refused if they hold a quote.
// A quoted argument's trailing backslashes would escape the closing quote, so they double.
const winArg = (s) =>
  /[\s]/.test(s) || s === "" ? `"${s.replace(/(\\+)$/, "$1$1")}"` : s;

/**
 * The Task Scheduler definition, for `schtasks /Create /XML`. It runs at logon as
 * the current user without elevation, never times out, and restarts on failure —
 * Task Scheduler's smallest restart interval is one minute, so a crash loop is
 * slower here than on the other two platforms.
 *
 * `%` is refused: Task Scheduler expands %VARIABLE% in an action's arguments, and a
 * path containing one would be silently rewritten.
 */
export function renderTaskXml({ node, args, workDir, user }) {
  for (const value of [node, workDir, user, ...args]) {
    if (String(value).includes("%")) {
      throw new Error(`a path containing "%" cannot be used in a scheduled task: ${value}`);
    }
  }
  const argLine = args.map(winArg).join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>career-ops web dashboard. Starts at logon, runs as the current user, restarts on failure.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xmlEscape(user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>255</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(node)}</Command>
      <Arguments>${xmlEscape(argLine)}</Arguments>
      <WorkingDirectory>${xmlEscape(workDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** Where each platform keeps the definition the installer writes. */
export function definitionPath({ platform, home, xdgConfigHome }) {
  if (platform === "darwin") return path.join(home, "Library", "LaunchAgents", `${SERVICE.launchdLabel}.plist`);
  if (platform === "linux") {
    return path.join(xdgConfigHome || path.join(home, ".config"), "systemd", "user", SERVICE.systemdUnit);
  }
  return null;
}
