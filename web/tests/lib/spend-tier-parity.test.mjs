// The web's tier → model table (spend-tier-model.mjs) mirrors the batch
// runner's. This runs batch/batch-runner.sh's own read_spend_tier and
// spend_tier_to_model, so a change on one side without the other fails here.
//
// Run (from web/): node --test tests/lib/spend-tier-parity.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveCodeRoot } from "../../src/lib/core/code-root.mjs";
import { CLAUDE_TIER_MODELS, spendTierFrom } from "../../src/lib/spend-tier-model.mjs";

// resolveCodeRoot() honours CAREER_OPS_CODE_ROOT. Its default assumes a cwd of
// <checkout>/web; the root suite runs from the checkout, so fall back to the
// checkout this file sits in.
const here = dirname(fileURLToPath(import.meta.url));
const runner = [resolveCodeRoot(process.cwd(), process.env), resolve(here, "../../..")]
  .map((root) => join(root, "batch", "batch-runner.sh"))
  .find((file) => existsSync(file));

/** The body of one shell function, from `name() {` to its closing `}` at column 0. */
function shellFunction(source, name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, "m").exec(source);
  assert.ok(match, `${name}() not found in batch/batch-runner.sh`);
  return match[0];
}

const bash = (script, env = {}) => execFileSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const skip = process.platform === "win32" ? "bash is not assumed on Windows" : !runner ? "batch/batch-runner.sh not found" : false;

test("each tier names the same Claude model in the web and in batch-runner.sh", { skip }, () => {
  const fn = shellFunction(readFileSync(runner, "utf8"), "spend_tier_to_model");
  for (const [tier, model] of Object.entries(CLAUDE_TIER_MODELS)) {
    assert.equal(bash(`${fn}\nspend_tier_to_model ${tier}`), model, tier);
  }
});

test("every profile value resolves to the same tier on both sides", { skip }, () => {
  const source = readFileSync(runner, "utf8");
  const script = `${shellFunction(source, "read_spend_tier")}\n${shellFunction(source, "spend_tier_to_model")}\nspend_tier_to_model "$(read_spend_tier 2>/dev/null)"`;
  const dir = mkdtempSync(join(tmpdir(), "spend-tier-parity-"));
  try {
    const profile = join(dir, "profile.yml");
    const profiles = [
      "candidate:\n  full_name: A\n",
      "spend_tier: turbo\n",
      "spend_tier: Premium\n",
      "spend_tier: economy\n",
      "spend_tier: ' Premium '\n",
      'spend_tier: " economy "\n',
      "spend_tier: 'premium'\n",
      "spend_tier: premium   # most capable\n",
      "spend_tier: ' turbo '\n",
    ];
    for (const text of profiles) {
      writeFileSync(profile, text);
      assert.equal(bash(script, { PROFILE_FILE: profile, DATA_ROOT: dir }), CLAUDE_TIER_MODELS[spendTierFrom(text)], JSON.stringify(text));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
