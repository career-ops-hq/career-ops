// Tests for resolveNpmShim() — the #2375 fix at the spawn boundary.
// Imports directly from resolve-npm-shim.mjs (the single source of truth) so
// the test and production code can never drift.
//
// Run:  node --test tests/lib/resolve-npm-shim.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveNpmShim } from "../../src/lib/resolve-npm-shim.mjs";

// An in-memory "filesystem" so the tests are platform-independent: they
// simulate win32 on any host, and never touch the real %APPDATA%.
function fakeFs(files) {
  return {
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    exists: (p) => Object.prototype.hasOwnProperty.call(files, norm(p)),
    readFile: (p) => {
      const key = norm(p);
      if (!(key in files)) throw new Error(`ENOENT ${p}`);
      return files[key];
    },
  };
}
// Keys are compared with the host's separator so path.join/resolve output matches.
const norm = (p) => p.replace(/[\\/]+/g, path.sep).toLowerCase();
const npm = path.join("C:", "Users", "u", "AppData", "Roaming", "npm");
const at = (...parts) => norm(path.join(npm, ...parts));

const cmdShimExe = [
  "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
].join("\r\n");

const cmdShimJs = [
  "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', ")",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\neovim\\bin\\cli.js" %*',
].join("\r\n");

const shShimExe = [
  "#!/bin/sh",
  'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
  'exec "$basedir/node_modules/@anthropic-ai/claude-code/bin/claude.exe"   "$@"',
].join("\n");

test("a .cmd shim wrapping a native .exe resolves to the .exe, no prefix args", () => {
  const files = {
    [at("claude.cmd")]: cmdShimExe,
    [at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]: "",
  };
  const r = resolveNpmShim(path.join(npm, "claude.cmd"), fakeFs(files));
  assert.equal(norm(r.file), at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  assert.deepEqual(r.prefixArgs, []);
});

test("the bare (sh) shim is resolved via its .cmd sibling — the case the web app hits", () => {
  // findBin() returns the extensionless shim first (#2375); it must still land
  // on the real binary.
  const files = {
    [at("claude")]: shShimExe,
    [at("claude.cmd")]: cmdShimExe,
    [at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]: "",
  };
  const r = resolveNpmShim(path.join(npm, "claude"), fakeFs(files));
  assert.equal(norm(r.file), at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
});

test("a .ps1 shim also resolves through the .cmd sibling", () => {
  const files = {
    [at("claude.cmd")]: cmdShimExe,
    [at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]: "",
  };
  const r = resolveNpmShim(path.join(npm, "claude.ps1"), fakeFs(files));
  assert.equal(norm(r.file), at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
});

test("a .cmd shim wrapping a .js entry launches node with the script as argv[0]", () => {
  const files = {
    [at("neovim-node-host.cmd")]: cmdShimJs,
    [at("node_modules", "neovim", "bin", "cli.js")]: "",
  };
  const fsx = fakeFs(files);
  const r = resolveNpmShim(path.join(npm, "neovim-node-host.cmd"), fsx);
  assert.equal(r.file, fsx.execPath);
  assert.equal(r.prefixArgs.length, 1);
  assert.equal(norm(r.prefixArgs[0]), at("node_modules", "neovim", "bin", "cli.js"));
});

test("falls back to the sh shim when no .cmd sibling exists", () => {
  const files = {
    [at("claude")]: shShimExe,
    [at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]: "",
  };
  const r = resolveNpmShim(path.join(npm, "claude"), fakeFs(files));
  assert.equal(norm(r.file), at("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
});

test("a real .exe path passes through untouched", () => {
  const exe = path.join("C:", "Tools", "agy", "bin", "agy.exe");
  const r = resolveNpmShim(exe, fakeFs({}));
  assert.deepEqual(r, { file: exe, prefixArgs: [] });
});

test("non-Windows platforms pass through untouched even for a bare path", () => {
  const bin = "/usr/local/bin/claude";
  const r = resolveNpmShim(bin, { ...fakeFs({}), platform: "linux" });
  assert.deepEqual(r, { file: bin, prefixArgs: [] });
});

test("a shim whose target is missing on disk passes through (spawn reports the real error)", () => {
  const files = { [at("claude.cmd")]: cmdShimExe }; // no claude.exe present
  const shim = path.join(npm, "claude.cmd");
  const r = resolveNpmShim(shim, fakeFs(files));
  assert.deepEqual(r, { file: shim, prefixArgs: [] });
});

test("a shim pointing outside its own directory is refused", () => {
  // A crafted shim is just a file; it must not redirect the spawn elsewhere.
  const evil = '"%dp0%\\node_modules\\..\\..\\..\\Windows\\System32\\cmd.exe" %*';
  const files = {
    [at("claude.cmd")]: evil,
    [norm(path.join("C:", "Users", "u", "Windows", "System32", "cmd.exe"))]: "",
  };
  const shim = path.join(npm, "claude.cmd");
  const r = resolveNpmShim(shim, fakeFs(files));
  assert.deepEqual(r, { file: shim, prefixArgs: [] });
});

test("an unreadable shim passes through instead of throwing", () => {
  const fsx = fakeFs({ [at("claude.cmd")]: "" });
  fsx.readFile = () => { throw new Error("EACCES"); };
  const shim = path.join(npm, "claude.cmd");
  assert.deepEqual(resolveNpmShim(shim, fsx), { file: shim, prefixArgs: [] });
});
