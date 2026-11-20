// The web must run Claude Code on the model the user's spend_tier names, as the
// CLI modes and batch-runner.sh do, instead of the CLI's own default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_TIER_MODELS, spendTierFrom, withSpendTierModel } from "../../src/lib/spend-tier-model.mjs";

function rootWithProfile(text) {
  const root = mkdtempSync(join(tmpdir(), "spend-tier-"));
  if (text !== null) {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "profile.yml"), text);
  }
  return root;
}

test("spendTierFrom follows the documented resolution", () => {
  assert.equal(spendTierFrom("spend_tier: economy\n"), "economy");
  assert.equal(spendTierFrom("spend_tier: ' Premium '\n"), "premium");
  assert.equal(spendTierFrom("spend_tier: standard\n"), "standard");
  assert.equal(spendTierFrom("candidate:\n  full_name: A\n"), "standard", "absent key");
  assert.equal(spendTierFrom("spend_tier: turbo\n"), "standard", "invalid value");
  assert.equal(spendTierFrom("spend_tier: [economy]\n"), "standard", "non-string value");
  assert.equal(spendTierFrom(null), "standard", "no profile");
});

test("claude runs get the tier's model through ANTHROPIC_MODEL", () => {
  for (const [tier, model] of Object.entries(CLAUDE_TIER_MODELS)) {
    const root = rootWithProfile(`spend_tier: ${tier}\n`);
    try {
      const out = withSpendTierModel("claude", { cwd: root, env: { PATH: "/bin" } });
      assert.equal(out.env.ANTHROPIC_MODEL, model);
      assert.equal(out.env.PATH, "/bin", "the rest of the environment is kept");
      assert.equal(out.cwd, root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a missing profile resolves to standard", () => {
  const root = rootWithProfile(null);
  try {
    assert.equal(withSpendTierModel("claude", { cwd: root, env: {} }).env.ANTHROPIC_MODEL, CLAUDE_TIER_MODELS.standard);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken or unreadable profile throws with its path instead of picking standard", () => {
  assert.throws(() => spendTierFrom("spend_tier: [economy\n"));
  const root = rootWithProfile("spend_tier: [economy\n");
  try {
    const file = join(root, "config", "profile.yml");
    const named = (err) => err instanceof Error && err.message.includes(file);
    assert.throws(() => withSpendTierModel("claude", { cwd: root, env: {} }), named);
    rmSync(file);
    mkdirSync(file); // reading a directory fails with EISDIR, not ENOENT
    assert.throws(() => withSpendTierModel("claude", { cwd: root, env: {} }), named);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CAREER_OPS_PROFILE is honoured", () => {
  const root = rootWithProfile("spend_tier: premium\n");
  try {
    writeFileSync(join(root, "alt.yml"), "spend_tier: economy\n");
    const out = withSpendTierModel("claude", { cwd: root, env: { CAREER_OPS_PROFILE: "alt.yml" } });
    assert.equal(out.env.ANTHROPIC_MODEL, CLAUDE_TIER_MODELS.economy);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an exported ANTHROPIC_MODEL wins over the tier", () => {
  const root = rootWithProfile("spend_tier: economy\n");
  try {
    const options = { cwd: root, env: { ANTHROPIC_MODEL: "claude-opus-5-5" } };
    assert.equal(withSpendTierModel("claude", options), options);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("other CLIs are left untouched", () => {
  const root = rootWithProfile("spend_tier: economy\n");
  try {
    const options = { cwd: root, env: {} };
    for (const cli of ["codex", "opencode", "gemini", "pi", "qwen"]) {
      assert.equal(withSpendTierModel(cli, options), options);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
