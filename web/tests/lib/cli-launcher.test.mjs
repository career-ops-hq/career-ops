import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { CODEX_WINDOWS_LAUNCH_ERROR, cliBinCandidates, findCliBin, findExecutableOnPath, prepareCliSpawn } from "../../src/lib/cli-launcher.mjs";

const win = (...parts) => path.join("C:\\tools", ...parts);
const accessFor = (existing) => (file) => { if (!existing.has(file)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; } };

test("codex.cmd is preferred over exe, ps1, and extensionless on Windows", () => { const dir = "C:\\tools"; const files = new Set([win("codex"), win("codex.cmd"), win("codex.exe"), win("codex.ps1")]); assert.equal(findCliBin("codex", [dir], { platform: "win32", accessSync: accessFor(files) }), win("codex.cmd")); });
test("codex.exe is the Windows fallback after cmd", () => { const files = new Set([win("codex.exe"), win("codex.ps1")]); assert.equal(findCliBin("codex", ["C:\\tools"], { platform: "win32", accessSync: accessFor(files) }), win("codex.exe")); });
test("codex.ps1 falls back through PowerShell", () => { const prepared = prepareCliSpawn(win("codex.ps1"), ["exec", "prompt"], { platform: "win32", env: {}, findExecutable: (name) => name === "pwsh" ? "C:\\PowerShell\\pwsh.exe" : null }); assert.equal(prepared.command, "C:\\PowerShell\\pwsh.exe"); assert.deepEqual(prepared.args.slice(-3), [win("codex.ps1"), "exec", "prompt"]); });
test("powershell.exe is used when pwsh is unavailable", () => { const prepared = prepareCliSpawn(win("codex.ps1"), [], { platform: "win32", env: {}, findExecutable: (name) => name === "powershell.exe" ? "C:\\Windows\\powershell.exe" : null }); assert.equal(prepared.command, "C:\\Windows\\powershell.exe"); });
test("PATH lookup searches each Windows directory", () => { const expected = path.join("D:\\npm", "codex.cmd"); const found = findExecutableOnPath("codex", { platform: "win32", env: { PATH: "C:\\none;D:\\npm" }, accessSync: accessFor(new Set([expected])) }); assert.equal(found, expected); });
test("invalid PowerShell launcher fails clearly", () => { assert.throws(() => prepareCliSpawn(win("codex.ps1"), [], { platform: "win32", env: {}, findExecutable: () => null }), new RegExp(CODEX_WINDOWS_LAUNCH_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); });
test("cmd launcher uses cmd.exe without shell true and keeps a single escaped command", () => { const prepared = prepareCliSpawn(win("codex.cmd"), ["exec", "a & b"], { platform: "win32", env: { ComSpec: "C:\\Windows\\cmd.exe" } }); assert.equal(prepared.command, "C:\\Windows\\cmd.exe"); assert.deepEqual(prepared.args.slice(0, 3), ["/d", "/s", "/c"]); assert.match(prepared.args[3], /\^&/); assert.equal(prepared.options.windowsVerbatimArguments, true); });
test("Linux and macOS launchers remain direct", () => { for (const platform of ["linux", "darwin"]) assert.deepEqual(prepareCliSpawn("/usr/bin/codex", ["exec", "p"], { platform }), { command: "/usr/bin/codex", args: ["exec", "p"], options: {} }); });
test("non-Codex candidate behavior remains platform appropriate", () => { assert.deepEqual(cliBinCandidates("claude", { platform: "linux" }), ["claude"]); assert.ok(cliBinCandidates("claude", { platform: "win32", pathext: ".EXE;.CMD" }).includes("claude.exe")); });
