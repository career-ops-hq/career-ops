import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import { loadProfileCadence } from "../../../followup-cadence.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const { GET, POST } = await import("../../src/app/api/followups/cadence/route.ts");

const PROFILE = `candidate:
  full_name: Fixture Candidate
followup_cadence:
  applied_first_days: 10.5
  applied_subsequent_days: "10 days"
  responded_initial_days: "0x10"
  applied_max_followups: 4
`;

function post(body) {
  return new Request("http://fixture.invalid/api/followups/cadence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withProfile(text, fn) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "career-ops-cadence-int-")));
  mkdirSync(path.join(root, "config"));
  const file = path.join(root, "config", "profile.yml");
  writeFileSync(file, text);
  writeFileSync(path.join(root, "config", "profile.example.yml"), "candidate:\n  full_name: Template Person\n");
  const saved = process.env.CAREER_OPS_ROOT;
  const savedProfile = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    await fn(file);
  } finally {
    if (saved === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved;
    if (savedProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = savedProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

test("a cadence that is not a whole number stays at the CLI default", async () => {
  await withProfile(PROFILE, async (file) => {
    const cli = loadProfileCadence(file);
    assert.equal(cli.applied_first, undefined);
    assert.equal(cli.applied_subsequent, undefined);
    assert.equal(cli.responded_initial, undefined);
    assert.equal(cli.applied_max_followups, 4);

    const loaded = await (await GET()).json();
    assert.equal(loaded.overrides.applied_first_days, undefined);
    assert.equal(loaded.overrides.applied_subsequent_days, undefined);
    assert.equal(loaded.overrides.responded_initial_days, undefined);
    assert.equal(loaded.overrides.applied_max_followups, 4);
    // 10, 10, and 0 are what parseInt made of these three values. Neither
    // side may show those. When the core defaults load, the form shows 7, 7,
    // and 1. When they do not, the knob stays blank.
    if (loaded.defaultsAvailable) {
      assert.equal(loaded.effective.applied_first_days, 7);
      assert.equal(loaded.effective.applied_subsequent_days, 7);
      assert.equal(loaded.effective.responded_initial_days, 1);
    } else {
      assert.equal(loaded.effective.applied_first_days, undefined);
      assert.equal(loaded.effective.applied_subsequent_days, undefined);
      assert.equal(loaded.effective.responded_initial_days, undefined);
    }
  });
});

test("saving a truncated cadence number is refused", async () => {
  const intact = `candidate:
  full_name: Fixture Candidate
followup_cadence:
  applied_first_days: 12
`;
  await withProfile(intact, async (file) => {
    for (const value of ["10.5", "10 days", "0x10", 10.5]) {
      const saved = await POST(post({ applied_first_days: value }));
      assert.equal(saved.status, 400, String(value));
      assert.equal(readFileSync(file, "utf8"), intact);
    }
    const ok = await POST(post({ applied_first_days: 9 }));
    assert.equal(ok.status, 200);
    assert.equal(yaml.load(readFileSync(file, "utf8")).followup_cadence.applied_first_days, 9);
  });
});
