// An unreadable modes/_profile.md must not be replaced by a stub.
//
// rememberFact() appends a fact to the CANONICAL modes/_profile.md. It read the
// file like this:
//
//   let md = "";
//   try { md = fs.readFileSync(p, "utf8"); } catch { md = ""; }
//
// and then decided what to write from whether md looked empty:
//
//   const base = md.trim() ? md.replace(/\n*$/, "\n") : "# Profile customization\n";
//   atomicWrite(p, base + section);
//
// So a profile that EXISTS but cannot be read (EACCES, EISDIR, EIO) took the
// "empty" branch and was overwritten with a one-line stub plus the new note.
// That file is User Layer — the user's archetypes, North Star, negotiation
// scripts and proof points, hand-written, feeding every A-F evaluation — and
// AGENTS.md says the User Layer is NEVER auto-updated. Clobbering it is worse
// than any wrong answer this route could give.
//
// ENOENT still means "no profile yet" and must: the first remembered fact on a
// fresh checkout creates the file. That case has its own test below, because
// the fix is "distinguish the errors", not "refuse when the file is missing".
//
// The unreadable file is a DIRECTORY in its place: readFileSync answers EISDIR,
// which reproduces as a non-root user on every platform the suite runs on,
// unlike chmod 000. web/tests/lib/whats-new-read-failure.test.mjs does the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// A file:// URL, not a bare path: `--import` takes a module SPECIFIER, and on
// Windows an absolute path starts with a drive letter that Node reads as a URL
// scheme. POSIX tolerates the path form, so the bug would be invisible locally.
const LOADER = pathToFileURL(join(WEB, "tests", "helpers", "web-ts-alias-loader.mjs")).href;

const REAL_PROFILE = [
  "# Profile customization",
  "",
  "## Archetypes",
  "- Head of Applied AI",
  "- Staff ML Engineer (platform)",
  "",
  "## North Star",
  "Own model deployment end to end, not just the notebook.",
  "",
].join("\n");

const DRIVER = `
const { rememberFact } = await import("@/lib/career-ops.ts");
console.log(JSON.stringify({ result: rememberFact("a fact worth keeping") }));
`;

const roots = [];
function makeRoot(prepare) {
  const dir = mkdtempSync(join(tmpdir(), "co-profile-"));
  roots.push(dir);
  mkdirSync(join(dir, "modes"), { recursive: true });
  prepare?.(dir);
  return dir;
}

/** rememberFact()'s answer, from a child with the alias loader registered. */
function callRememberFact(root) {
  const driver = join(root, "driver.mjs");
  writeFileSync(driver, DRIVER);
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--import", LOADER, driver],
    {
      cwd: WEB,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: "" },
    },
  );
  // The loader prints deprecation notices to stderr; the payload is the last
  // stdout line, so a future warning cannot break the parse.
  return JSON.parse(out.trim().split("\n").filter(Boolean).at(-1));
}

test("a readable profile is appended to, and its content survives", () => {
  // The premise. Without this the rest proves nothing: if the happy path did
  // not preserve content, an unreadable file changing nothing would be unremarkable.
  const root = makeRoot((dir) => writeFileSync(join(dir, "modes", "_profile.md"), REAL_PROFILE));
  const res = callRememberFact(root);
  assert.equal(res.result, "ok");

  const after = readFileSync(join(root, "modes", "_profile.md"), "utf8");
  assert.match(after, /Head of Applied AI/, "the user's archetypes must still be there");
  assert.match(after, /Own model deployment end to end/, "and their North Star");
  assert.match(after, /a fact worth keeping/, "with the new fact appended");
});

test("an unreadable profile is refused, not replaced by a stub", () => {
  // THE BUG. A directory where the file belongs: readFileSync answers EISDIR,
  // which is the file being unreadable rather than absent.
  const root = makeRoot((dir) => mkdirSync(join(dir, "modes", "_profile.md")));
  const res = callRememberFact(root);

  assert.equal(res.result, "error", "an unreadable profile must not report success");
  // THE POINT: nothing was written over it. Before the fix this path wrote
  // "# Profile customization\n" plus the note, destroying the real file.
  assert.ok(statSync(join(root, "modes", "_profile.md")).isDirectory(),
    "the path must be exactly as it was found — not replaced by a stub file");
});

test("no profile at all is still a first run, not an error", () => {
  // The other half, and the reason this is not "refuse when the read fails".
  // A fresh checkout has no modes/_profile.md; the first fact creates it.
  const root = makeRoot();
  const res = callRememberFact(root);
  assert.equal(res.result, "ok", "ENOENT means no profile yet, which is normal");

  const after = readFileSync(join(root, "modes", "_profile.md"), "utf8");
  assert.match(after, /a fact worth keeping/);
});

process.on("exit", () => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
