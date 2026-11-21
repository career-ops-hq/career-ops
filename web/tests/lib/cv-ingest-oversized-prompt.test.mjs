// A CV too long for the command line reaches the CLI through a file.
//
// /api/cv/ingest inlines the whole CV into the prompt and passes that prompt
// as one argv element. The route accepts up to MAX_CV_SOURCE_CHARS (60,000)
// characters, more than the Windows command line holds (32,767 UTF-16 units),
// and a CV in a script of three UTF-8 bytes a character also passes the POSIX
// 128 KiB per-argument cap, so the spawn failed (`spawn ENAMETOOLONG` /
// `E2BIG`). The route now goes through spillOversizedPrompt, as /api/run
// (#6743) and the apply planner (#7150) do: an oversized prompt is written
// under the data root, argv carries a short pointer to it, and the file is
// removed on every exit path. A prompt that fits is passed as before.
//
// The fixture CV is 45,000 CJK characters: under the route's own limit, and
// over both platform limits (45,000 UTF-16 units; 135,000 UTF-8 bytes), so the
// spill happens on every OS. The real request handler runs with its CLI lookup
// and its spawn stubbed, as in evaluation-instructions-route.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude", name: "Fixture CLI", args: (p) => ["-p", p] }, binPath: "/fixture/never-run", substitutedFrom: null });
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
// Records the argv and the spilled prompt files present at spawn time, then
// runs a child that exits at once, so the route's close handler runs.
const spawnStub = `
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export function spawnHeadlessCli(bin, args, options) {
  globalThis.__ingestLaunch = {
    args,
    files: fs.readdirSync(options.cwd).filter(name => name.startsWith(".evaluation-instructions-")).map(name =>
      fs.readFileSync(path.join(options.cwd, name, "instructions.md"), "utf8")),
  };
  if (globalThis.__ingestSpawnMode === "throw") throw new Error("Fixture spawn failure");
  return spawn(process.execPath, ["-e", "process.exit(0)"], options);
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/cv/ingest/route.ts");
const { MAX_CV_SOURCE_CHARS } = await import("../../src/lib/cv/upload.mjs");

const LONG_CV = `# 简历\n${"经验".repeat(22_500)}`.slice(0, 45_000);
const SHORT_CV = "# CV -- Fictional Candidate\n" + "Built reliable software. ".repeat(80);

/** A data root for one test, with the route's environment pointed at it. */
function useRoot(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-cv-ingest-spill-"));
  const previous = { root: process.env.CAREER_OPS_ROOT, code: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  globalThis.__ingestSpawnMode = mode;
  t.after(() => {
    if (previous.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous.root;
    if (previous.code === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previous.code;
    delete globalThis.__ingestSpawnMode;
    delete globalThis.__ingestLaunch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const ingest = (text) => POST(new Request("http://fixture.invalid/api/cv/ingest", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, cliId: "claude" }),
}));
const spillDirs = (root) => fs.readdirSync(root).filter(name => name.startsWith(".evaluation-instructions-"));

test("a CV too long for the command line reaches the CLI through a file, removed once it closes", async t => {
  const root = useRoot(t, "close");
  assert.ok(LONG_CV.length <= MAX_CV_SOURCE_CHARS, "precondition: the route accepts this CV");
  assert.ok(Buffer.byteLength(LONG_CV, "utf8") > 128 * 1024, "precondition: over the POSIX per-argument cap");
  const response = await ingest(LONG_CV);
  assert.equal(response.status, 200);
  await response.text();
  const launch = globalThis.__ingestLaunch;
  assert.ok(launch, "the route reached the spawn boundary");
  assert.ok(launch.args.join(" ").length < 8000, `argv still carries the CV: ${launch.args.join(" ").length} chars`);
  assert.equal(launch.files.length, 1, "the prompt went to one file under the data root");
  assert.ok(launch.files[0].includes(LONG_CV), "the file holds the whole CV");
  assert.deepEqual(spillDirs(root), [], "the file is removed when the CLI closes");
});

test("the spilled CV is removed when the spawn throws", async t => {
  const root = useRoot(t, "throw");
  const response = await ingest(LONG_CV);
  assert.equal(response.status, 500);
  assert.equal(globalThis.__ingestLaunch.files.length, 1);
  assert.deepEqual(spillDirs(root), []);
});

test("a CV that fits is passed in argv as before, and nothing is written", async t => {
  const root = useRoot(t, "close");
  const response = await ingest(SHORT_CV);
  assert.equal(response.status, 200);
  await response.text();
  const launch = globalThis.__ingestLaunch;
  assert.deepEqual(launch.files, []);
  assert.equal(launch.args[0], "-p");
  assert.ok(launch.args[1].includes(SHORT_CV.trim()), "the prompt still carries the CV inline");
  assert.deepEqual(spillDirs(root), []);
});
