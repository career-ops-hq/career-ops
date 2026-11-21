// End to end for spend_tier on the web: a fake `claude` started through the
// real spawnHeadlessCli() (with a real, fenced claude argv) must receive the
// tier's model in ANTHROPIC_MODEL, keep an exported one, and never start when
// the profile is broken.
//
// Run (from web/): node --experimental-strip-types --test tests/lib/spend-tier-spawn.test.mjs

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { spawnHeadlessCli } from "../../src/lib/spawn-cli.mjs";
import { claudeCliArgs } from "../../src/lib/claude-invocation.mjs";
import { capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";

// The same kind, argv and capabilities /api/run uses for a Score run.
const EVALUATE = capabilitiesFor("evaluate");
import { CLAUDE_TIER_MODELS } from "../../src/lib/spend-tier-model.mjs";

const skip = process.platform === "win32" ? "the fake CLI is a POSIX shebang script" : false;

const dir = mkdtempSync(join(tmpdir(), "spend-tier-spawn-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// Prints the model it was given, then exits: a stand-in for `claude -p`.
const fakeClaude = join(dir, "claude");
writeFileSync(fakeClaude, `#!${process.execPath}\nprocess.stdout.write(process.env.ANTHROPIC_MODEL ?? "<unset>");\n`);
chmodSync(fakeClaude, 0o755);

function dataRoot(profile) {
  const root = mkdtempSync(join(dir, "root-"));
  if (profile !== null) {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "profile.yml"), profile);
  }
  return root;
}

async function modelSeenBy(cliId, root, env = {}) {
  const args = cliId === "claude" ? claudeCliArgs({ kind: "evaluate", prompt: "score this" }) : ["-p", "score this"];
  const child = spawnHeadlessCli(fakeClaude, args, { cwd: root, env: { PATH: process.env.PATH, ...env } }, { cliId, capabilities: EVALUATE });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0);
  return out;
}

for (const [tier, model] of Object.entries(CLAUDE_TIER_MODELS)) {
  test(`spend_tier: ${tier} reaches the claude process as ${model}`, { skip }, async () => {
    assert.equal(await modelSeenBy("claude", dataRoot(`spend_tier: ${tier}\n`)), model);
  });
}

test("no profile, no key, or an unknown tier run on standard", { skip }, async () => {
  for (const profile of [null, "candidate:\n  full_name: A\n", "spend_tier: turbo\n"]) {
    assert.equal(await modelSeenBy("claude", dataRoot(profile)), CLAUDE_TIER_MODELS.standard, String(profile));
  }
});

test("an exported ANTHROPIC_MODEL reaches the process unchanged", { skip }, async () => {
  assert.equal(await modelSeenBy("claude", dataRoot("spend_tier: economy\n"), { ANTHROPIC_MODEL: "my-pinned-model" }), "my-pinned-model");
});

test("CAREER_OPS_PROFILE picks the profile the tier is read from", { skip }, async () => {
  const root = dataRoot("spend_tier: premium\n");
  writeFileSync(join(root, "other.yml"), "spend_tier: economy\n");
  assert.equal(await modelSeenBy("claude", root, { CAREER_OPS_PROFILE: "other.yml" }), CLAUDE_TIER_MODELS.economy);
});

test("a broken profile stops the run before anything is spawned", { skip }, () => {
  const root = dataRoot("spend_tier: [economy\n");
  const args = claudeCliArgs({ kind: "evaluate", prompt: "score this" });
  assert.throws(
    () => spawnHeadlessCli(fakeClaude, args, { cwd: root, env: { PATH: process.env.PATH } }, { cliId: "claude", capabilities: EVALUATE }),
    (err) => err instanceof Error && err.message.includes(join(root, "config", "profile.yml")),
  );
});

test("another CLI gets no model from the tier", { skip }, async () => {
  assert.equal(await modelSeenBy("gemini", dataRoot("spend_tier: economy\n")), "<unset>");
});
