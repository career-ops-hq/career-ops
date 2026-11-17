// An AI search prompt too long for the command line reaches the CLI through a file.
//
// /api/explore/ai builds its prompt from modes/discover.md, the output
// contract, the user's whole modes/_profile.md (readMemory) and the dedup
// block, and passes it as one argv element. The profile is the same content
// /api/run spills for (#6743): a long one takes the launch past the Windows
// command line (32,767 UTF-16 units) and the spawn fails with an opaque
// `spawn ENAMETOOLONG`. The route now goes through spillOversizedPrompt, as
// /api/run and the apply planner (#7150) do: an oversized prompt is written in
// the worker's cwd, argv carries a short pointer to it, and the file is removed
// on every exit path. A prompt that fits is passed as before.
//
// The fixture profile is 45,000 CJK characters, over both platform limits
// (45,000 UTF-16 units; 135,000 UTF-8 bytes, past the POSIX 128 KiB
// per-argument cap), so the spill happens on every OS. The real request
// handler runs with its CLI lookup and its spawn stubbed, as in
// evaluation-instructions-route.test.mjs.
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
  globalThis.__exploreLaunch = {
    args,
    files: fs.readdirSync(options.cwd).filter(name => name.startsWith(".evaluation-instructions-")).map(name =>
      fs.readFileSync(path.join(options.cwd, name, "instructions.md"), "utf8")),
  };
  if (globalThis.__exploreSpawnMode === "throw") throw new Error("Fixture spawn failure");
  return spawn(process.execPath, ["-e", "process.exit(0)"], options);
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/explore/ai/route.ts");

const LONG_PROFILE = `# 个人资料\n${"经验".repeat(22_500)}`.slice(0, 45_000);
const SHORT_PROFILE = "# Profile customization\nTarget: platform engineering roles in fictional cities.\n";

/** A data root holding `profile` as modes/_profile.md, with the route's environment pointed at it. */
function useRoot(t, mode, profile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-explore-ai-spill-"));
  fs.mkdirSync(path.join(root, "modes"));
  fs.writeFileSync(path.join(root, "modes", "_profile.md"), profile);
  const previous = { root: process.env.CAREER_OPS_ROOT, code: process.env.CAREER_OPS_CODE_ROOT, profile: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  delete process.env.CAREER_OPS_PROFILE;
  globalThis.__exploreSpawnMode = mode;
  t.after(() => {
    for (const [key, value] of [["CAREER_OPS_ROOT", previous.root], ["CAREER_OPS_CODE_ROOT", previous.code], ["CAREER_OPS_PROFILE", previous.profile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__exploreSpawnMode;
    delete globalThis.__exploreLaunch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const search = () => POST(new Request("http://fixture.invalid/api/explore/ai", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "platform engineering roles", cliId: "claude" }),
}));
const spillDirs = (root) => fs.readdirSync(root).filter(name => name.startsWith(".evaluation-instructions-"));

test("a prompt too long for the command line reaches the CLI through a file, removed once it closes", async t => {
  const root = useRoot(t, "close", LONG_PROFILE);
  assert.ok(Buffer.byteLength(LONG_PROFILE, "utf8") > 128 * 1024, "precondition: over the POSIX per-argument cap");
  const response = await search();
  assert.equal(response.status, 200);
  await response.text();
  const launch = globalThis.__exploreLaunch;
  assert.ok(launch, "the route reached the spawn boundary");
  assert.ok(launch.args.join(" ").length < 8000, `argv still carries the prompt: ${launch.args.join(" ").length} chars`);
  assert.equal(launch.files.length, 1, "the prompt went to one file in the worker's cwd");
  assert.ok(launch.files[0].includes(LONG_PROFILE), "the file holds the whole profile");
  assert.match(launch.files[0], /--- USER INTENT ---\nplatform engineering roles/);
  assert.deepEqual(spillDirs(root), [], "the file is removed when the CLI closes");
});

test("the spilled prompt is removed when the spawn throws", async t => {
  const root = useRoot(t, "throw", LONG_PROFILE);
  const response = await search();
  assert.equal(response.status, 500);
  assert.equal(globalThis.__exploreLaunch.files.length, 1);
  assert.deepEqual(spillDirs(root), []);
});

test("a prompt that fits is passed in argv as before, and nothing is written", async t => {
  const root = useRoot(t, "close", SHORT_PROFILE);
  const response = await search();
  assert.equal(response.status, 200);
  await response.text();
  const launch = globalThis.__exploreLaunch;
  assert.deepEqual(launch.files, []);
  assert.equal(launch.args[0], "-p");
  assert.ok(launch.args[1].includes(SHORT_PROFILE.trim()), "the prompt still carries the profile inline");
  assert.deepEqual(spillDirs(root), []);
});
