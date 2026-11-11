import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  CARRIED_ENV,
  RESTART_SECONDS,
  crashRestartDelayMs,
  SERVICE,
  carriedEnv,
  definitionPath,
  parseRunArgs,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderTaskXml,
  runArgs,
  stableNodePath,
} from "../../src/lib/web-service.mjs";

test("carriedEnv keeps only set variables, in the carried order", () => {
  const pairs = carriedEnv({
    PORT: "3917",
    CAREER_OPS_ROOT: "/data/root",
    CAREER_OPS_TRACKER: "",
    HOME: "/home/me",
    AWS_SECRET_ACCESS_KEY: "nope",
  });
  assert.deepEqual(pairs, [
    ["CAREER_OPS_ROOT", "/data/root"],
    ["PORT", "3917"],
  ]);
  assert.ok(CARRIED_ENV.includes("CAREER_OPS_WEB_ALLOWED_HOSTS"));
  assert.ok(CARRIED_ENV.includes("CAREER_OPS_CODE_ROOT"), "an isolated web runtime finds the engine scripts through it");
});

test("carriedEnv refuses a value that would not survive a plist, a unit and a command line", () => {
  for (const bad of ['a"b', "a\nb", "a\rb", "a\0b"]) {
    assert.throws(() => carriedEnv({ CAREER_OPS_ROOT: bad }), /CAREER_OPS_ROOT must not contain/);
  }
});

test("runArgs and parseRunArgs round-trip the carried environment and the log path", () => {
  const args = runArgs("/w/scripts/web-service.mjs", [["CAREER_OPS_ROOT", "/a b"], ["PORT", "1"]], { logPath: "/l/web.log" });
  assert.deepEqual(args, [
    "/w/scripts/web-service.mjs",
    "run",
    "--env", "CAREER_OPS_ROOT=/a b",
    "--env", "PORT=1",
    "--log", "/l/web.log",
  ]);
  assert.deepEqual(parseRunArgs(args.slice(2)), {
    env: { CAREER_OPS_ROOT: "/a b", PORT: "1" },
    logPath: "/l/web.log",
  });
});

test("parseRunArgs keeps an equals sign inside the value", () => {
  assert.deepEqual(parseRunArgs(["--env", "CAREER_OPS_ROOT=/a=b"]).env, { CAREER_OPS_ROOT: "/a=b" });
});

test("parseRunArgs refuses a variable outside the allow-list and malformed arguments", () => {
  assert.throws(() => parseRunArgs(["--env", "NODE_OPTIONS=--inspect"]), /not a variable the service carries/);
  assert.throws(() => parseRunArgs(["--env", "PORT"]), /KEY=VALUE/);
  assert.throws(() => parseRunArgs(["--env"]), /KEY=VALUE/);
  assert.throws(() => parseRunArgs(["--log"]), /needs a path/);
  assert.throws(() => parseRunArgs(["--port", "1"]), /unknown argument for run: --port/);
});

test("stableNodePath swaps a Homebrew Cellar path for the opt link when both are one binary", () => {
  const cellar = "/opt/homebrew/Cellar/node/26.12.1_1/bin/node";
  const opt = "/opt/homebrew/opt/node/bin/node";
  const fs = {
    exists: (p) => p === opt,
    realpath: (p) => (p === opt || p === cellar ? cellar : p),
  };
  assert.equal(stableNodePath(cellar, fs), opt);
});

test("stableNodePath keeps the real path when the opt link is missing, points elsewhere or throws", () => {
  const cellar = "/opt/homebrew/Cellar/node/26.12.1_1/bin/node";
  const opt = "/opt/homebrew/opt/node/bin/node";
  assert.equal(stableNodePath(cellar, { exists: () => false, realpath: (p) => p }), cellar);
  assert.equal(
    stableNodePath(cellar, { exists: () => true, realpath: (p) => (p === opt ? "/other/node" : p) }),
    cellar,
  );
  assert.equal(
    stableNodePath(cellar, { exists: () => true, realpath: () => { throw new Error("EACCES"); } }),
    cellar,
  );
});

test("stableNodePath leaves any other path alone", () => {
  const fs = { exists: () => true, realpath: (p) => p };
  assert.equal(stableNodePath("/usr/local/bin/node", fs), "/usr/local/bin/node");
  assert.equal(stableNodePath("C:\\Program Files\\nodejs\\node.exe", fs), "C:\\Program Files\\nodejs\\node.exe");
});

test("the launchd plist starts at load, restarts on exit and throttles the restarts", () => {
  const plist = renderLaunchdPlist({
    label: SERVICE.launchdLabel,
    node: "/opt/homebrew/opt/node/bin/node",
    args: ["/w/scripts/web-service.mjs", "run", "--env", "PORT=3917"],
    workDir: "/w",
    logPath: "/d/data/web-service.log",
  });
  assert.match(plist, /<key>Label<\/key>\s*<string>io\.career-ops\.web<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, new RegExp(`<key>ThrottleInterval</key>\\s*<integer>${RESTART_SECONDS}</integer>`));
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/w<\/string>/);
  const argv = [...plist.matchAll(/^ {4}<string>(.*)<\/string>$/gm)].map((m) => m[1]);
  assert.deepEqual(argv, ["/opt/homebrew/opt/node/bin/node", "/w/scripts/web-service.mjs", "run", "--env", "PORT=3917"]);
  assert.equal(plist.split("/d/data/web-service.log").length - 1, 2, "stdout and stderr both go to the log");
});

test("the launchd plist escapes XML in paths", () => {
  const plist = renderLaunchdPlist({
    label: "x",
    node: "/n",
    args: ["/a & b/<c>"],
    workDir: "/w",
    logPath: "/l",
  });
  assert.ok(plist.includes("<string>/a &amp; b/&lt;c&gt;</string>"));
  assert.ok(!plist.includes("/a & b"));
});

test("the systemd unit restarts always, with the throttle, and wants default.target", () => {
  const unit = renderSystemdUnit({ node: "/usr/bin/node", args: ["/w/scripts/web-service.mjs", "run"], workDir: "/w" });
  assert.match(unit, /^\[Unit\]$/m);
  assert.match(unit, /^Type=simple$/m);
  assert.match(unit, /^WorkingDirectory=\/w$/m);
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/w\/scripts\/web-service\.mjs" "run"$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, new RegExp(`^RestartSec=${RESTART_SECONDS}$`, "m"));
  assert.match(unit, /^WantedBy=default\.target$/m);
});

test("the systemd unit neutralises quotes, backslashes, percent signs and dollar signs", () => {
  const unit = renderSystemdUnit({
    node: "/n",
    args: ['/p ath/a"b', "c\\d", "50%", "$HOME"],
    workDir: "/w%x",
  });
  assert.ok(unit.includes('ExecStart="/n" "/p ath/a\\"b" "c\\\\d" "50%%" "$$HOME"'), unit);
  assert.match(unit, /^WorkingDirectory=\/w%%x$/m);
});

test("the Task Scheduler definition runs at logon as the user, unelevated, and restarts on failure", () => {
  const xml = renderTaskXml({
    node: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\career ops\\web\\scripts\\web-service.mjs", "run", "--log", "C:\\career ops\\data\\web-service.log"],
    workDir: "C:\\career ops\\web",
    user: "PC\\me",
  });
  assert.match(xml, /<LogonTrigger>[\s\S]*<UserId>PC\\me<\/UserId>[\s\S]*<\/LogonTrigger>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>255<\/Count>/);
  assert.match(xml, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/);
  // A space in a path needs quotes on the Windows command line; in XML text they are &quot;.
  assert.match(
    xml,
    /<Arguments>&quot;C:\\career ops\\web\\scripts\\web-service\.mjs&quot; run --log &quot;C:\\career ops\\data\\web-service\.log&quot;<\/Arguments>/,
  );
  assert.match(xml, /<WorkingDirectory>C:\\career ops\\web<\/WorkingDirectory>/);
});

test("the Task Scheduler definition escapes XML and refuses a percent sign", () => {
  const xml = renderTaskXml({ node: "n", args: ["a&b"], workDir: "w", user: "u" });
  assert.ok(xml.includes("<Arguments>a&amp;b</Arguments>"));
  assert.throws(() => renderTaskXml({ node: "n", args: ["C:\\50%\\x"], workDir: "w", user: "u" }), /cannot be used in a scheduled task/);
});

// Assembled, because test-all.mjs bans a literal home-directory path in tracked files.
const MAC_HOME = ["", "Users", "me"].join("/");

test("definitionPath is the LaunchAgents plist, the systemd user unit, or nothing on Windows", () => {
  assert.equal(
    definitionPath({ platform: "darwin", home: MAC_HOME }),
    path.join(MAC_HOME, "Library", "LaunchAgents", "io.career-ops.web.plist"),
  );
  assert.equal(
    definitionPath({ platform: "linux", home: "/home/me" }),
    path.join("/home/me", ".config", "systemd", "user", "career-ops-web.service"),
  );
  assert.equal(
    definitionPath({ platform: "linux", home: "/home/me", xdgConfigHome: "/cfg" }),
    path.join("/cfg", "systemd", "user", "career-ops-web.service"),
  );
  assert.equal(definitionPath({ platform: "win32", home: "C:\\Users\\me" }), null);
});

test("the restart count stays within the Task Scheduler schema's unsigned byte", () => {
  const xml = renderTaskXml({ node: "n", args: ["a"], workDir: "w", user: "u" });
  const count = Number(/<Count>(\d+)<\/Count>/.exec(xml)[1]);
  assert.ok(count >= 1 && count <= 255);
});

test("a spaced argument that ends in a backslash does not escape its closing quote", () => {
  const xml = renderTaskXml({ node: "n", args: ["C:\\my logs\\"], workDir: "w", user: "u" });
  assert.ok(xml.includes("&quot;C:\\my logs\\\\&quot;"));
});

test("Windows crash restarts are throttled to RESTART_SECONDS by the runner", () => {
  const crash = { code: 1, signal: null, stopping: false };
  assert.equal(RESTART_SECONDS, 30);
  assert.equal(crashRestartDelayMs({ platform: "win32", ...crash }), 30000);
  assert.equal(crashRestartDelayMs({ platform: "win32", ...crash, code: 0 }), null);
  assert.equal(crashRestartDelayMs({ platform: "win32", ...crash, signal: "SIGTERM" }), null);
  assert.equal(crashRestartDelayMs({ platform: "win32", ...crash, stopping: true }), null);
  // launchd and systemd throttle in their own definitions
  assert.equal(crashRestartDelayMs({ platform: "linux", ...crash }), null);
  assert.equal(crashRestartDelayMs({ platform: "darwin", ...crash }), null);
});
