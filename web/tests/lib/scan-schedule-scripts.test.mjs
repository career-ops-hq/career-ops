import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skip = process.platform === "win32";
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const MARKER = "# career-ops recurring scan";
const LABEL = "io.career-ops.scheduled-scan";

// Files the installer and uninstaller need, copied into a temp root so the tests never touch the real checkout.
const COPIED = [
  "path-resolver.mjs",
  "web/src/lib/scheduled-runner-path.mjs",
  "web/scripts/install-scan-schedule.sh",
  "web/scripts/uninstall-scan-schedule.sh",
];

const STUBS = {
  uname: 'echo "${FAKE_UNAME:-Linux}"',
  id: `if [ "\${1:-}" = "-u" ]; then echo "\${FAKE_UID:-1000}"; else exit 1; fi`,
  crontab: [
    'echo "$*" >> "$FAKE_CRON.calls"',
    'case "${1:-}" in',
    '  -l) if [ -f "$FAKE_CRON" ]; then cat "$FAKE_CRON"; else echo "no crontab for user" >&2; exit 1; fi ;;',
    '  -) cat > "$FAKE_CRON" ;;',
    '  -r) rm -f "$FAKE_CRON" ;;',
    "esac",
  ].join("\n"),
  launchctl: [
    'echo "$*" >> "$FAKE_LAUNCHCTL_LOG"',
    'case "${1:-}" in',
    '  print) exit "${FAKE_PRINT_EXIT:-0}" ;;',
    "  bootstrap)",
    '    n=$(cat "$FAKE_LAUNCHCTL_LOG.fails" 2>/dev/null || echo 0)',
    '    if [ "$n" -lt "${FAKE_BOOTSTRAP_FAILS:-0}" ]; then echo $((n + 1)) > "$FAKE_LAUNCHCTL_LOG.fails"; echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi ;;',
    "esac",
  ].join("\n"),
  sleep: "exit 0",
};

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-sched-"));
  let root = path.join(dir, "root");
  fs.mkdirSync(root);
  root = fs.realpathSync(root);
  for (const rel of COPIED) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dest);
  }
  // The installer only checks that the runner exists.
  fs.writeFileSync(path.join(root, "web", "scripts", "scheduled-jobs-runner.mjs"), "");
  const dataRoot = path.join(dir, "data-root");
  fs.mkdirSync(dataRoot);
  const installScript = path.join(root, "web/scripts/install-scan-schedule.sh");
  const uninstallScript = path.join(root, "web/scripts/uninstall-scan-schedule.sh");

  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const cron = path.join(dir, "crontab");
  const launchctlLog = path.join(dir, "launchctl.log");
  const plist = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const run = (script, env = {}, { defaultPaths = false } = {}) => {
    const base = { ...process.env };
    // Keep the host's path overrides out of the install under test.
    for (const key of ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_SCHEDULED_JOBS_PATH"]) delete base[key];
    // Point the store at a scratch root unless the test asks for defaults or sets its own overrides.
    const scratch = !defaultPaths && !Object.keys(env).some((key) => key.startsWith("CAREER_OPS_")) ? { CAREER_OPS_ROOT: dataRoot } : {};
    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...base,
        HOME: home,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_CRON: cron,
        FAKE_LAUNCHCTL_LOG: launchctlLog,
        ...scratch,
        ...env,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: result.stdout + result.stderr };
  };
  const cronLines = () => fs.readFileSync(cron, "utf8").split("\n").filter(Boolean);
  const cronCalls = () => (fs.existsSync(`${cron}.calls`) ? fs.readFileSync(`${cron}.calls`, "utf8").split("\n").filter(Boolean) : []);
  const launchctlCalls = () => (fs.existsSync(launchctlLog) ? fs.readFileSync(launchctlLog, "utf8").split("\n").filter(Boolean) : []);
  return {
    dir,
    root,
    dataRoot,
    cron,
    plist,
    launchctlLog,
    installScript,
    uninstallScript,
    run,
    cronLines,
    cronCalls,
    launchctlCalls,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function withSandbox(fn) {
  const sb = sandbox();
  try {
    return fn(sb);
  } finally {
    sb.cleanup();
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

test("linux install writes one marked cron line", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, {}, { defaultPaths: true });
  assert.equal(result.status, 0, result.out);
  const lines = sb.cronLines();
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^\\*/15 \\* \\* \\* \\* cd '${escapeRe(sb.root)}' && .* ${escapeRe(MARKER)}$`));
  assert.ok(lines[0].includes("scheduled-jobs-runner.mjs"));
  assert.ok(lines[0].includes(`touch '${path.join(sb.root, "data", "scheduled-jobs.json.tick")}'`), lines[0]);
  assert.ok(!lines[0].includes("CAREER_OPS_"), lines[0]);
}));

test("linux install is idempotent", { skip }, () => withSandbox((sb) => {
  assert.equal(sb.run(sb.installScript).status, 0);
  assert.equal(sb.run(sb.installScript).status, 0);
  assert.equal(sb.cronLines().filter((l) => l.endsWith(MARKER)).length, 1);
}));

test("linux install keeps unrelated cron lines", { skip }, () => withSandbox((sb) => {
  fs.writeFileSync(sb.cron, "0 8 * * * echo hi\n");
  assert.equal(sb.run(sb.installScript).status, 0);
  const lines = sb.cronLines();
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "0 8 * * * echo hi");
  assert.ok(lines[1].endsWith(MARKER));
}));

test("linux install bakes path overrides into the command and moves the tick", { skip }, () => withSandbox((sb) => {
  const store = path.join(sb.dir, "custom", "jobs.json");
  const result = sb.run(sb.installScript, { CAREER_OPS_SCHEDULED_JOBS_PATH: store, CAREER_OPS_DATA_DIR: sb.dir });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes(`touch '${store}.tick'`), line);
  assert.ok(line.includes(`CAREER_OPS_SCHEDULED_JOBS_PATH='${store}'`), line);
  assert.ok(line.includes(`CAREER_OPS_DATA_DIR='${sb.dir}'`), line);
  assert.ok(line.includes(`2>>'${path.dirname(store)}/scheduled-jobs.log'`), line);
  assert.ok(fs.statSync(path.dirname(store)).isDirectory());
}));

test("install rejects a path override containing a single quote", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, { CAREER_OPS_DATA_DIR: "/tmp/it's" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /single quote/);
  assert.ok(!fs.existsSync(sb.cron));
}));

test("linux install escapes % for cron", { skip }, () => withSandbox((sb) => {
  const pct = path.join(sb.dir, "p%ct");
  const result = sb.run(sb.installScript, { CAREER_OPS_ROOT: pct });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes("p\\%ct"), line);
  assert.doesNotMatch(line, /(?<!\\)%/);
}));

test("linux reinstall replaces an old marker line", { skip }, () => withSandbox((sb) => {
  fs.writeFileSync(sb.cron, `*/15 * * * * cd '/old/root' && true ${MARKER}\n`);
  assert.equal(sb.run(sb.installScript).status, 0);
  const markerLines = sb.cronLines().filter((l) => l.endsWith(MARKER));
  assert.equal(markerLines.length, 1);
  assert.ok(markerLines[0].includes(`cd '${sb.root}'`), markerLines[0]);
  assert.ok(!fs.readFileSync(sb.cron, "utf8").includes("/old/root"));
}));

test("linux uninstall removes only the marked line", { skip }, () => withSandbox((sb) => {
  fs.writeFileSync(sb.cron, "0 8 * * * echo hi\n");
  assert.equal(sb.run(sb.installScript).status, 0);
  const result = sb.run(sb.uninstallScript);
  assert.equal(result.status, 0, result.out);
  assert.equal(fs.readFileSync(sb.cron, "utf8"), "0 8 * * * echo hi\n");
  assert.match(result.out, /Removed/);
}));

test("linux uninstall with no crontab does nothing", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.uninstallScript);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /not installed/);
  assert.ok(!sb.cronCalls().includes("-"));
  assert.ok(!sb.cronCalls().includes("-r"));
}));

test("macos install writes the plist and bootstraps after bootout", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, { FAKE_UNAME: "Darwin" });
  assert.equal(result.status, 0, result.out);
  const plist = fs.readFileSync(sb.plist, "utf8");
  assert.match(plist, /<key>StartCalendarInterval<\/key>[\s\S]*<integer>0<\/integer>[\s\S]*<integer>15<\/integer>[\s\S]*<integer>30<\/integer>[\s\S]*<integer>45<\/integer>/);
  assert.match(plist, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${escapeRe(sb.root)}</string>`));
  const calls = sb.launchctlCalls();
  const bootout = calls.findIndex((l) => l.startsWith("bootout "));
  const bootstrap = calls.findIndex((l) => l === `bootstrap gui/1000 ${sb.plist}`);
  assert.ok(bootout >= 0 && bootstrap > bootout, calls.join("\n"));
  assert.equal(sb.cronCalls().length, 0);
}));

test("macos install retries bootstrap and succeeds", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, { FAKE_UNAME: "Darwin", FAKE_BOOTSTRAP_FAILS: "2" });
  assert.equal(result.status, 0, result.out);
  assert.equal(sb.launchctlCalls().filter((l) => l.startsWith("bootstrap ")).length, 3);
  assert.ok(fs.existsSync(sb.plist));
}));

test("macos install removes the plist when bootstrap keeps failing", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, { FAKE_UNAME: "Darwin", FAKE_BOOTSTRAP_FAILS: "99" });
  assert.equal(result.status, 1, result.out);
  assert.match(result.stderr, /launchctl bootstrap failed/);
  assert.equal(sb.launchctlCalls().filter((l) => l.startsWith("bootstrap ")).length, 5);
  assert.equal(fs.existsSync(sb.plist), false);
}));

test("macos reinstall restores the old plist when bootstrap keeps failing", { skip }, () => withSandbox((sb) => {
  fs.mkdirSync(path.dirname(sb.plist), { recursive: true });
  fs.writeFileSync(sb.plist, "<!-- old plist -->\n");
  const result = sb.run(sb.installScript, { FAKE_UNAME: "Darwin", FAKE_BOOTSTRAP_FAILS: "99" });
  assert.equal(result.status, 1, result.out);
  assert.equal(fs.readFileSync(sb.plist, "utf8"), "<!-- old plist -->\n");
  // Five failed attempts, then one bootstrap of the restored plist.
  assert.equal(sb.launchctlCalls().filter((l) => l.startsWith("bootstrap ")).length, 6);
}));

test("macos plist runs the job command with XML escaping", { skip }, () => withSandbox((sb) => {
  const special = path.join(sb.dir, "a&b<c>");
  const result = sb.run(sb.installScript, { FAKE_UNAME: "Darwin", CAREER_OPS_ROOT: special });
  assert.equal(result.status, 0, result.out);
  const plist = fs.readFileSync(sb.plist, "utf8");
  const prefix = `cd '${sb.root}' && touch '${special}/data/scheduled-jobs.json.tick' && `;
  const m = plist.match(/<string>\/bin\/sh<\/string>\s*<string>-c<\/string>\s*<string>([^<]*)<\/string>/);
  assert.ok(m, plist);
  assert.ok(m[1].startsWith(xml(prefix)), m[1]);
  assert.ok(m[1].includes("2&gt;&gt;'"), m[1]);
  assert.match(plist, new RegExp(`<string>${escapeRe(xml(prefix))}`));
  if (process.platform === "darwin") {
    const lint = spawnSync("plutil", ["-lint", sb.plist], { encoding: "utf8" });
    if (!lint.error) assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
}));

test("macos uninstall removes the plist and boots out the job", { skip }, () => withSandbox((sb) => {
  assert.equal(sb.run(sb.installScript, { FAKE_UNAME: "Darwin" }).status, 0);
  fs.rmSync(sb.launchctlLog, { force: true });
  const result = sb.run(sb.uninstallScript, { FAKE_UNAME: "Darwin" });
  assert.equal(result.status, 0, result.out);
  assert.ok(!fs.existsSync(sb.plist));
  assert.deepEqual(sb.launchctlCalls(), [`bootout gui/1000/${LABEL}`]);
  assert.match(result.out, /Removed/);
}));

test("install refuses to run as root", { skip }, () => withSandbox((sb) => {
  for (const uname of ["Linux", "Darwin"]) {
    const result = sb.run(sb.installScript, { FAKE_UID: "0", FAKE_UNAME: uname });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not run as root/);
  }
  assert.ok(!fs.existsSync(sb.plist));
  assert.ok(!fs.existsSync(sb.cron));
}));

test("install rejects an unsupported OS without writing", { skip }, () => withSandbox((sb) => {
  const result = sb.run(sb.installScript, { FAKE_UNAME: "FreeBSD" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported OS/);
  assert.ok(!fs.existsSync(sb.plist));
  assert.ok(!fs.existsSync(sb.cron));
  assert.equal(sb.launchctlCalls().length, 0);
}));

test("install creates data/ and does not run a tick", { skip }, () => withSandbox((sb) => {
  const dataDir = path.join(sb.root, "data");
  const tick = path.join(dataDir, "scheduled-jobs.json.tick");
  assert.equal(fs.existsSync(dataDir), false);
  assert.equal(sb.run(sb.installScript, {}, { defaultPaths: true }).status, 0);
  assert.ok(fs.statSync(dataDir).isDirectory());
  assert.equal(fs.existsSync(tick), false);
}));

// A Homebrew `node` reports a versioned Cellar path as process.execPath; `brew upgrade` deletes that folder.
function fakeBrewNode(sb, { optVersion }) {
  const prefix = path.join(fs.realpathSync(sb.dir), "brew");
  const versions = ["1.0", "2.0"];
  const execPaths = {};
  for (const version of versions) {
    const bin = path.join(prefix, "Cellar", "node", version, "bin");
    fs.mkdirSync(bin, { recursive: true });
    execPaths[version] = path.join(bin, "node");
    // Reports its own Cellar path for the execPath probe and defers everything else to the real node.
    fs.writeFileSync(
      execPaths[version],
      `#!/bin/sh\nif [ "$1" = "-e" ]; then printf '%s' '${execPaths[version]}'; else exec '${process.execPath}' "$@"; fi\n`,
      { mode: 0o755 },
    );
  }
  if (optVersion) {
    fs.mkdirSync(path.join(prefix, "opt"), { recursive: true });
    fs.symlinkSync(path.join(prefix, "Cellar", "node", optVersion), path.join(prefix, "opt", "node"));
  }
  const shim = path.join(sb.dir, "brew-shim");
  fs.mkdirSync(shim);
  fs.symlinkSync(execPaths["1.0"], path.join(shim, "node"));
  return { prefix, cellarNode: execPaths["1.0"], optNode: path.join(prefix, "opt", "node", "bin", "node"), PATH: `${shim}${path.delimiter}${path.join(sb.dir, "bin")}${path.delimiter}${process.env.PATH}` };
}

test("install pins the Homebrew opt path so a brew upgrade does not break the schedule", { skip }, () => withSandbox((sb) => {
  const brew = fakeBrewNode(sb, { optVersion: "1.0" });
  const result = sb.run(sb.installScript, { PATH: brew.PATH });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes(`'${brew.optNode}' 'web/scripts/scheduled-jobs-runner.mjs'`), line);
  assert.ok(!line.includes("/Cellar/"), line);
}));

test("install keeps the Cellar path when the opt link points at another version", { skip }, () => withSandbox((sb) => {
  const brew = fakeBrewNode(sb, { optVersion: "2.0" });
  const result = sb.run(sb.installScript, { PATH: brew.PATH });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes(`'${brew.cellarNode}' 'web/scripts/scheduled-jobs-runner.mjs'`), line);
}));

test("install keeps the Cellar path when there is no opt link", { skip }, () => withSandbox((sb) => {
  const brew = fakeBrewNode(sb, { optVersion: null });
  const result = sb.run(sb.installScript, { PATH: brew.PATH });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes(`'${brew.cellarNode}' 'web/scripts/scheduled-jobs-runner.mjs'`), line);
}));
