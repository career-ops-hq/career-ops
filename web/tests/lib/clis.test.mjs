import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCliLaunch } from "../../src/lib/cli-launch.mjs";

test("prepareCliLaunch leaves POSIX commands unchanged", () => {
  const args = ["-p", "hello"];
  assert.deepEqual(prepareCliLaunch("/usr/local/bin/gemini", args, "linux"), {
    command: "/usr/local/bin/gemini",
    args,
  });
});

test("prepareCliLaunch leaves native Windows executables unchanged", () => {
  const args = ["exec", "hello"];
  assert.deepEqual(prepareCliLaunch("C:\\tools\\codex.exe", args, "win32"), {
    command: "C:\\tools\\codex.exe",
    args,
  });
});

test("prepareCliLaunch resolves an npm Windows shim to its real Node entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cli-"));
  try {
    const bare = path.join(dir, "gemini");
    const ps1 = `${bare}.ps1`;
    const entry = path.join(dir, "node_modules", "example", "cli.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// test entry\n", "utf8");
    fs.writeFileSync(ps1, '& "node$exe" "$basedir/node_modules/example/cli.js" $args\n', "utf8");
    const prompt = 'review this & echo "not a shell command"';
    const launch = prepareCliLaunch(bare, ["-p", prompt], "win32");

    assert.equal(launch.command, process.execPath);
    assert.deepEqual(launch.args, [entry, "-p", prompt]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareCliLaunch handles a discovered .cmd shim when an adjacent .ps1 exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cli-"));
  try {
    const cmd = path.join(dir, "gemini.cmd");
    const ps1 = path.join(dir, "gemini.ps1");
    const entry = path.join(dir, "node_modules", "example", "cli.cjs");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// test entry\n", "utf8");
    fs.writeFileSync(ps1, '& "node$exe" "$basedir/node_modules/example/cli.cjs" $args\n', "utf8");
    const launch = prepareCliLaunch(cmd, ["--help"], "win32");
    assert.equal(launch.command, process.execPath);
    assert.deepEqual(launch.args, [entry, "--help"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareCliLaunch resolves an npm shim that targets a native executable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cli-"));
  try {
    const bare = path.join(dir, "opencode");
    const ps1 = `${bare}.ps1`;
    const entry = path.join(dir, "node_modules", "example", "opencode.exe");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "", "utf8");
    fs.writeFileSync(ps1, '& "$basedir/node_modules/example/opencode.exe" $args\n', "utf8");
    const launch = prepareCliLaunch(bare, ["run", "hello"], "win32");
    assert.deepEqual(launch, { command: entry, args: ["run", "hello"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareCliLaunch preserves the original command when no PowerShell shim exists", () => {
  const missing = path.join(os.tmpdir(), `career-ops-missing-${Date.now()}`, "gemini");
  assert.deepEqual(prepareCliLaunch(missing, ["-p", "hello"], "win32"), {
    command: missing,
    args: ["-p", "hello"],
  });
});
