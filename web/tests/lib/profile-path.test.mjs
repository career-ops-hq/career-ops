// The web's profile.yml path resolver mirrors the core's getProfilePath()
// (path-resolver.mjs) where the two contracts agree: the CAREER_OPS_PROFILE
// override wins when no root is stated, and an explicit root names its own
// config/profile.yml (#5026). It differs on purpose in two places: its first
// argument is the data root (so the override wins unless explicitRoot is set,
// where core's rootDir argument always beats it), and a relative override
// resolves against that root, not the cwd.
//
// The web cannot import the core helper (Turbopack's root is pinned to web/), so
// this is a mirror; tests/web-profile-path-parity.test.mjs in the root suite
// compares it with the core helper itself and is the guard that keeps the two
// from drifting.
//
// Run:  node --test tests/lib/profile-path.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getProfilePath } from "../../src/lib/core/profile-path.mjs";

const ROOT = path.resolve("/fixture/data-root");
const DEFAULT = path.join(ROOT, "config", "profile.yml");
const OVERRIDE = path.resolve("/fixture/elsewhere/me.yml");

test("no override: <root>/config/profile.yml", () => {
  assert.equal(getProfilePath(ROOT, { env: {} }), DEFAULT);
});

test("override wins when the root is the web's derived data root", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: OVERRIDE } }), OVERRIDE);
});

test("override is trimmed", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: `  ${OVERRIDE}\n` } }), OVERRIDE);
});

test("empty or whitespace override counts as unset", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: "" } }), DEFAULT);
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: "   \t " } }), DEFAULT);
});

test("an explicit root beats the override", () => {
  assert.equal(getProfilePath(ROOT, { explicitRoot: true, env: { CAREER_OPS_PROFILE: OVERRIDE } }), DEFAULT);
});

test("reads process.env by default", () => {
  const prev = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_PROFILE = OVERRIDE;
  try {
    assert.equal(getProfilePath(ROOT), OVERRIDE);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = prev;
  }
});

// A relative CAREER_OPS_PROFILE resolves like the core's sibling lane variables
// (CAREER_OPS_PORTALS, CAREER_OPS_PIPELINE, CAREER_OPS_SCAN_HISTORY): against the
// cwd the core CLI runs in. The web's own cwd is <checkout>/web, one directory too
// deep, while the core scripts it spawns run with cwd = the root it passes, so the
// base here is the `root` argument, never process.cwd().
import fs from "node:fs";
import os from "node:os";

async function withCwdAndEnv(cwd, profile, fn) {
  const prev = { cwd: process.cwd(), profile: process.env.CAREER_OPS_PROFILE };
  process.chdir(cwd);
  process.env.CAREER_OPS_PROFILE = profile;
  try {
    return await fn();
  } finally {
    process.chdir(prev.cwd);
    if (prev.profile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = prev.profile;
  }
}

test("relative override resolves against the root argument", () => {
  assert.equal(
    getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: "profiles/me.yml" } }),
    path.join(ROOT, "profiles", "me.yml"),
  );
});

test("absolute override passes through unchanged", () => {
  assert.equal(getProfilePath(ROOT, { env: { CAREER_OPS_PROFILE: OVERRIDE } }), OVERRIDE);
});

test("relative override ignores the cwd when it is <checkout>/web, as under next", async () => {
  const { fileURLToPath } = await import("node:url");
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  await withCwdAndEnv(path.join(checkout, "web"), "profiles/me.yml", () => {
    assert.equal(getProfilePath(ROOT), path.join(ROOT, "profiles", "me.yml"));
  });
});

test("relative override ignores an unrelated cwd", async () => {
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "profile-path-cwd-")));
  try {
    await withCwdAndEnv(elsewhere, "profiles/me.yml", () => {
      assert.equal(getProfilePath(ROOT), path.join(ROOT, "profiles", "me.yml"));
    });
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
