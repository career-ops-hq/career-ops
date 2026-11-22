import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installService,
  restartService,
  serviceStatus,
  uninstallService,
} from "../../src/lib/web-service-ops.mjs";

// A scratch home and web/ directory, a `run` that records every OS command and
// answers from a script, and the platform under test passed in as a string — so all
// three platforms are exercised from whichever one runs the suite.
function sandbox(platform, { env = {}, results = {}, root = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-svc-ops-"));
  const webDir = path.join(dir, "web");
  fs.mkdirSync(path.join(webDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(webDir, "scripts", "web-service.mjs"), "");
  fs.writeFileSync(path.join(webDir, "package-lock.json"), "{}");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);

  const calls = [];
  const lines = [];
  const sleeps = [];
  const queues = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, [...v]]));
  const run = (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const queue = Object.entries(queues).find(([prefix]) => key.startsWith(prefix))?.[1];
    return queue?.length > 1 ? queue.shift() : (queue?.[0] ?? { status: 0, stdout: "", stderr: "" });
  };
  const ctx = {
    platform,
    home,
    uid: 501,
    user: "PC\\me",
    isRoot: root,
    execPath: platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/local/bin/node",
    webDir,
    env,
    logPath: path.join(dir, "data", "web-service.log"),
    tmpDir: dir,
    fs,
    run,
    sleep: async (ms) => sleeps.push(ms),
    out: (line) => lines.push(line),
  };
  return { dir, ctx, calls, lines, sleeps, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function withSandbox(platform, options, fn) {
  const sb = sandbox(platform, options);
  try {
    return await fn(sb);
  } finally {
    sb.cleanup();
  }
}

const ok = { status: 0, stdout: "", stderr: "" };
const fail = (stderr = "boom") => ({ status: 5, stdout: "", stderr });

test("macOS install writes the LaunchAgent, boots out the old job, then bootstraps", () => withSandbox("darwin", {}, async (sb) => {
  const result = await installService(sb.ctx);
  const plist = path.join(sb.ctx.home, "Library", "LaunchAgents", "io.career-ops.web.plist");
  assert.equal(result.file, plist);
  const text = fs.readFileSync(plist, "utf8");
  assert.ok(text.includes(path.join(sb.ctx.webDir, "scripts", "web-service.mjs")));
  assert.deepEqual(sb.calls, [
    "launchctl bootout gui/501/io.career-ops.web",
    `launchctl bootstrap gui/501 ${plist}`,
  ]);
  assert.ok(sb.lines.some((l) => l.includes("Installed io.career-ops.web")));
  assert.ok(fs.existsSync(path.dirname(sb.ctx.logPath)), "the log directory exists before launchd opens the log");
}));

test("macOS install carries the exported overrides and nothing else", () => withSandbox(
  "darwin",
  { env: { CAREER_OPS_ROOT: "/my data", PORT: "3917", AWS_SECRET_ACCESS_KEY: "x" } },
  async (sb) => {
    const { text } = await installService(sb.ctx);
    assert.ok(text.includes("<string>CAREER_OPS_ROOT=/my data</string>"));
    assert.ok(text.includes("<string>PORT=3917</string>"));
    assert.ok(!text.includes("AWS_SECRET"));
  },
));

test("macOS install retries a bootstrap that races the old job's removal", () => withSandbox(
  "darwin",
  { results: { "launchctl bootstrap": [fail(), fail(), ok] } },
  async (sb) => {
    await installService(sb.ctx);
    assert.equal(sb.calls.filter((c) => c.startsWith("launchctl bootstrap")).length, 3);
    assert.deepEqual(sb.sleeps, [1000, 1000]);
  },
));

test("macOS install that cannot bootstrap removes the new plist and says why", () => withSandbox(
  "darwin",
  { results: { "launchctl bootstrap": [fail("Bootstrap failed: 5")] } },
  async (sb) => {
    await assert.rejects(installService(sb.ctx), /logged-in GUI session is required.*Bootstrap failed: 5/s);
    const plist = path.join(sb.ctx.home, "Library", "LaunchAgents", "io.career-ops.web.plist");
    assert.ok(!fs.existsSync(plist));
    assert.equal(sb.calls.filter((c) => c.startsWith("launchctl bootstrap")).length, 5);
  },
));

test("macOS install that cannot bootstrap restores the previous plist", () => withSandbox(
  "darwin",
  { results: { "launchctl bootstrap": [fail(), fail(), fail(), fail(), fail(), ok] } },
  async (sb) => {
    const plist = path.join(sb.ctx.home, "Library", "LaunchAgents", "io.career-ops.web.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "previous");
    await assert.rejects(installService(sb.ctx), /launchctl bootstrap failed/);
    assert.equal(fs.readFileSync(plist, "utf8"), "previous");
    assert.equal(sb.calls.at(-1), `launchctl bootstrap gui/501 ${plist}`, "the previous job is loaded again");
  },
));

test("Linux install writes the user unit, then reloads, enables and restarts it", () => withSandbox("linux", {}, async (sb) => {
  await installService(sb.ctx);
  const unit = path.join(sb.ctx.home, ".config", "systemd", "user", "career-ops-web.service");
  assert.match(fs.readFileSync(unit, "utf8"), /^Restart=always$/m);
  assert.deepEqual(sb.calls, [
    "systemctl --user daemon-reload",
    "systemctl --user enable career-ops-web.service",
    "systemctl --user restart career-ops-web.service",
  ]);
  assert.ok(sb.lines.some((l) => l.includes("journalctl --user -u career-ops-web.service")));
  assert.ok(sb.lines.some((l) => l.includes("enable-linger")));
}));

test("Linux install honours XDG_CONFIG_HOME", () => withSandbox("linux", {}, async (sb) => {
  sb.ctx.xdgConfigHome = path.join(sb.dir, "cfg");
  const { file } = await installService(sb.ctx);
  assert.equal(file, path.join(sb.dir, "cfg", "systemd", "user", "career-ops-web.service"));
  assert.ok(fs.existsSync(file));
}));

test("Linux install without a systemd user session explains what is missing", () => withSandbox(
  "linux",
  { results: { "systemctl --user enable": [fail("Failed to connect to bus")] } },
  async (sb) => {
    await assert.rejects(installService(sb.ctx), /enable career-ops-web\.service failed: Failed to connect to bus[\s\S]*user session/);
    assert.ok(!sb.calls.some((c) => c.includes("restart")), "nothing is started after a failed enable");
  },
));

test("Windows install registers the task from a UTF-16 definition, then starts it", () => withSandbox("win32", {}, async (sb) => {
  let definition;
  const run = sb.ctx.run;
  sb.ctx.run = (command, args) => {
    if (args[0] === "/Create") definition = fs.readFileSync(args[args.indexOf("/XML") + 1]);
    return run(command, args);
  };
  await installService(sb.ctx);

  assert.deepEqual(sb.calls.map((c) => c.split(" ").slice(0, 3).join(" ")), [
    "schtasks /Create /TN",
    "schtasks /Run /TN",
  ]);
  assert.match(sb.calls[0], /\/TN career-ops web \/XML .*career-ops-web-task\.xml \/F$/);
  assert.deepEqual([...definition.subarray(0, 2)], [0xff, 0xfe], "UTF-16 LE byte-order mark");
  const xml = definition.subarray(2).toString("utf16le");
  assert.match(xml, /<UserId>PC\\me<\/UserId>/);
  assert.match(xml, new RegExp(`--log "?${sb.ctx.logPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(!fs.existsSync(path.join(sb.dir, "career-ops-web-task.xml")), "the temporary definition is removed");
}));

test("Windows install removes the temporary definition and throws when /Create fails", () => withSandbox(
  "win32",
  { results: { "schtasks /Create": [fail("Access is denied")] } },
  async (sb) => {
    await assert.rejects(installService(sb.ctx), /schtasks \/Create failed: Access is denied/);
    assert.ok(!fs.existsSync(path.join(sb.dir, "career-ops-web-task.xml")));
    assert.ok(!sb.calls.some((c) => c.startsWith("schtasks /Run")));
  },
));

test("Windows install that cannot start the task now still succeeds and says so", () => withSandbox(
  "win32",
  { results: { "schtasks /Run": [fail("not now")] } },
  async (sb) => {
    await installService(sb.ctx);
    assert.ok(sb.lines.some((l) => l.includes("will start at your next logon")));
  },
));

test("install --dry-run prints the definition and changes nothing, on every platform", async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    await withSandbox(platform, {}, async (sb) => {
      const result = await installService(sb.ctx, { dryRun: true });
      assert.equal(result.installed, false);
      assert.deepEqual(sb.calls, [], platform);
      assert.ok(sb.lines.join("\n").includes(result.text.split("\n")[1]), platform);
      assert.ok(!fs.existsSync(path.join(sb.ctx.home, "Library")), platform);
      assert.ok(!fs.existsSync(path.join(sb.ctx.home, ".config")), platform);
      assert.ok(!fs.existsSync(path.dirname(sb.ctx.logPath)), platform);
    });
  }
});

test("install refuses to run as root, on an unsupported platform, and without its files", async () => {
  await withSandbox("linux", { root: true }, async (sb) => {
    await assert.rejects(installService(sb.ctx), /must not run as root/);
    assert.deepEqual(sb.calls, []);
  });
  await withSandbox("freebsd", {}, async (sb) => {
    await assert.rejects(installService(sb.ctx), /unsupported platform: freebsd/);
  });
  await withSandbox("linux", {}, async (sb) => {
    fs.rmSync(path.join(sb.ctx.webDir, "package-lock.json"));
    await assert.rejects(installService(sb.ctx), /package-lock\.json not found/);
  });
  await withSandbox("linux", {}, async (sb) => {
    fs.rmSync(path.join(sb.ctx.webDir, "scripts", "web-service.mjs"));
    await assert.rejects(installService(sb.ctx), /runner not found/);
  });
});

test("install refuses an override value it cannot carry", () => withSandbox(
  "linux",
  { env: { CAREER_OPS_ROOT: 'a"b' } },
  async (sb) => {
    await assert.rejects(installService(sb.ctx), /CAREER_OPS_ROOT must not contain/);
    assert.deepEqual(sb.calls, []);
  },
));

test("uninstall removes the macOS agent and the plist", () => withSandbox("darwin", {}, async (sb) => {
  const plist = path.join(sb.ctx.home, "Library", "LaunchAgents", "io.career-ops.web.plist");
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, "x");
  uninstallService(sb.ctx);
  assert.ok(!fs.existsSync(plist));
  assert.deepEqual(sb.calls, ["launchctl bootout gui/501/io.career-ops.web"]);
  assert.deepEqual(sb.lines, ["Removed io.career-ops.web."]);
}));

test("uninstall says so when nothing is installed", async () => {
  for (const [platform, expected] of [
    ["darwin", "io.career-ops.web is not installed."],
    ["linux", "career-ops-web.service is not installed."],
  ]) {
    await withSandbox(platform, {}, async (sb) => {
      uninstallService(sb.ctx);
      assert.deepEqual(sb.lines, [expected]);
    });
  }
  await withSandbox("win32", { results: { "schtasks /Query": [{ status: 0x80070002, stdout: "", stderr: "" }] } }, async (sb) => {
    uninstallService(sb.ctx);
    assert.deepEqual(sb.lines, ['Task "career-ops web" is not installed.']);
    assert.deepEqual(sb.calls, ["schtasks /Query /TN career-ops web /HRESULT"]);
  });
});

test("uninstall disables the Linux unit, removes the file and reloads", () => withSandbox("linux", {}, async (sb) => {
  const unit = path.join(sb.ctx.home, ".config", "systemd", "user", "career-ops-web.service");
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  fs.writeFileSync(unit, "x");
  uninstallService(sb.ctx);
  assert.ok(!fs.existsSync(unit));
  assert.deepEqual(sb.calls, [
    "systemctl --user disable --now career-ops-web.service",
    "systemctl --user daemon-reload",
  ]);
}));

test("uninstall ends and deletes the Windows task", () => withSandbox("win32", {}, async (sb) => {
  uninstallService(sb.ctx);
  assert.deepEqual(sb.calls, [
    "schtasks /Query /TN career-ops web /HRESULT",
    "schtasks /End /TN career-ops web",
    "schtasks /Delete /TN career-ops web /F",
  ]);
  assert.deepEqual(sb.lines, ['Removed task "career-ops web".']);
}));

test("restart kickstarts launchd, restarts systemd and cycles the Windows task", async () => {
  await withSandbox("darwin", {}, async (sb) => {
    restartService(sb.ctx);
    assert.deepEqual(sb.calls, ["launchctl kickstart -k gui/501/io.career-ops.web"]);
  });
  await withSandbox("linux", {}, async (sb) => {
    restartService(sb.ctx);
    assert.deepEqual(sb.calls, ["systemctl --user restart career-ops-web.service"]);
  });
  await withSandbox("win32", {}, async (sb) => {
    restartService(sb.ctx);
    assert.deepEqual(sb.calls, ["schtasks /End /TN career-ops web", "schtasks /Run /TN career-ops web"]);
  });
});

test("restart of a service that is not installed fails with a hint", () => withSandbox(
  "linux",
  { results: { "systemctl --user restart": [fail("Unit career-ops-web.service not found.")] } },
  async (sb) => {
    assert.throws(() => restartService(sb.ctx), /is the service installed\?.*not found/s);
  },
));

test("status prints the platform's account and reports installed", () => withSandbox(
  "darwin",
  { results: { "launchctl print": [{ status: 0, stdout: "state = running\n", stderr: "" }] } },
  async (sb) => {
    assert.equal(serviceStatus(sb.ctx), true);
    assert.deepEqual(sb.calls, ["launchctl print gui/501/io.career-ops.web"]);
    assert.equal(sb.lines[0], "state = running");
    assert.ok(sb.lines[1].includes(sb.ctx.logPath));
  },
));

test("status reports not installed, and treats an inactive Linux unit as installed", async () => {
  await withSandbox("darwin", { results: { "launchctl print": [{ status: 113, stdout: "", stderr: "Could not find service" }] } }, async (sb) => {
    assert.equal(serviceStatus(sb.ctx), false);
    assert.deepEqual(sb.lines, ["Not installed."]);
  });
  await withSandbox(
    "linux",
    { results: { "systemctl --user status": [{ status: 3, stdout: "inactive (dead)\n", stderr: "" }] } },
    async (sb) => {
      assert.equal(serviceStatus(sb.ctx), true);
    },
  );
  await withSandbox(
    "linux",
    { results: { "systemctl --user status": [{ status: 4, stdout: "", stderr: "not found" }] } },
    async (sb) => {
      assert.equal(serviceStatus(sb.ctx), false);
    },
  );
});

test("status reports a command failure instead of claiming the service is absent", async () => {
  await withSandbox("linux", { results: { "systemctl --user status": [{ status: 1, stdout: "", stderr: "Failed to connect to bus" }] } }, async (sb) => {
    assert.throws(() => serviceStatus(sb.ctx), /could not query the service.*Failed to connect to bus/s);
  });
  await withSandbox("darwin", { results: { "launchctl print": [fail("Bootstrap failed")] } }, async (sb) => {
    assert.throws(() => serviceStatus(sb.ctx), /could not query the service/);
  });
});

test("uninstall keeps the definition when the service could not be stopped", async () => {
  await withSandbox("darwin", { results: { "launchctl bootout": [fail("Operation not permitted")] } }, async (sb) => {
    const plist = path.join(sb.ctx.home, "Library", "LaunchAgents", "io.career-ops.web.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "x");
    assert.throws(() => uninstallService(sb.ctx), /bootout failed/);
    assert.ok(fs.existsSync(plist));
  });
  await withSandbox("linux", { results: { "systemctl --user disable": [fail("Failed to connect to bus")] } }, async (sb) => {
    const unit = path.join(sb.ctx.home, ".config", "systemd", "user", "career-ops-web.service");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, "x");
    assert.throws(() => uninstallService(sb.ctx), /disable failed/);
    assert.ok(fs.existsSync(unit));
  });
});

test("Windows uninstall and status tell a missing task from a failed query", async () => {
  const denied = { status: 0x80070005, stdout: "", stderr: "Access is denied" };
  await withSandbox("win32", { results: { "schtasks /Query": [denied] } }, async (sb) => {
    assert.throws(() => uninstallService(sb.ctx), /could not query the task.*Access is denied/s);
    assert.ok(!sb.calls.some((c) => c.startsWith("schtasks /Delete")));
  });
  await withSandbox("win32", { results: { "schtasks /Query": [denied] } }, async (sb) => {
    assert.throws(() => serviceStatus(sb.ctx), /could not query the service/);
  });
  for (const status of [0x80070002, -2147024894]) {
    await withSandbox("win32", { results: { "schtasks /Query": [{ status, stdout: "", stderr: "" }] } }, async (sb) => {
      assert.equal(serviceStatus(sb.ctx), false);
    });
  }
});
