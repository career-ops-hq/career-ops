// The web sites listed below read or write config/profile.yml through
// getProfilePath(), so they must follow CAREER_OPS_PROFILE the way the core's
// honoring modules do (#5026). This file covers those sites only; it does not
// prove every reader is covered (the root suite's scan guard is the lexical
// backstop), and batch/batch-runner.sh and the prompts under modes/ and batch/
// are outside this change.
//
// Each case runs the REAL code against a data root holding profile A at the
// default location and profile B elsewhere, with CAREER_OPS_PROFILE naming B.
// The two carry distinguishable values, so a site that ignores the variable
// reads A and the assertion names which file it used.
//
// Run:  node --test tests/lib/profile-path-sites.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import "../helpers/web-ts-alias-loader.mjs";

const { readLanguageConfig, doctorState } = await import("../../src/lib/career-ops.ts");
const { seedExploreFilters } = await import("../../src/lib/core/portals.ts");
const { loadProfileTargets, readScanTimeoutMs } = await import("../../src/lib/core/scan.ts");
const { POST: updateProfile } = await import("../../src/app/api/profile/route.ts");
const { GET: readCadence, POST: updateCadence } = await import("../../src/app/api/followups/cadence/route.ts");
const { resolvePdfPaths } = await import("../../src/lib/pdf-paths.mjs");
const { readFollowupsEnabled } = await import("../../src/lib/followups-server.ts");

const PROFILE_A = `candidate:
  full_name: Alpha Person
language:
  output: de
target_roles:
  primary: [Alpha Role]
scan:
  timeout_seconds: 111
followup_cadence:
  applied_first_days: 1
`;
const PROFILE_B = `candidate:
  full_name: Beta Person
language:
  output: ja
target_roles:
  primary: [Beta Role]
scan:
  timeout_seconds: 222
followup_cadence:
  applied_first_days: 2
follow_ups:
  enabled: false
`;

/** A data root with A at config/profile.yml and B in a sibling directory. */
async function withProfiles(fn, { writeB = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "career-ops-profile-sites-")));
  mkdirSync(path.join(root, "config"));
  const a = path.join(root, "config", "profile.yml");
  const b = path.join(root, "elsewhere", "beta.yml");
  writeFileSync(a, PROFILE_A);
  writeFileSync(path.join(root, "config", "profile.example.yml"), "candidate:\n  full_name: Template Person\n");
  if (writeB) {
    mkdirSync(path.dirname(b));
    writeFileSync(b, PROFILE_B);
  }
  const saved = { root: process.env.CAREER_OPS_ROOT, profile: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_PROFILE = b;
  try {
    await fn({ root, a, b });
  } finally {
    for (const [key, value] of [["CAREER_OPS_ROOT", saved.root], ["CAREER_OPS_PROFILE", saved.profile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const post = (route, body) =>
  new Request(`http://fixture.invalid/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("readLanguageConfig reads the override profile", async () => {
  await withProfiles(() => {
    assert.equal(readLanguageConfig().output, "ja");
  });
});

test("seedExploreFilters seeds the target roles from the override profile", async () => {
  await withProfiles(() => {
    assert.deepEqual(seedExploreFilters().filters.positive, ["Beta Role"]);
  });
});

test("scan loadProfileTargets reads the override profile", async () => {
  await withProfiles(() => {
    assert.deepEqual(loadProfileTargets(), ["Beta Role"]);
  });
});

test("scan readScanTimeoutMs reads the override profile", async () => {
  await withProfiles(() => {
    assert.equal(readScanTimeoutMs(), 222_000);
  });
});

test("pdf paths take the candidate slug from the override profile", async () => {
  await withProfiles(({ root }) => {
    const report = path.join(root, "reports", "018-acme-2026-07-01.md");
    const result = resolvePdfPaths("018", "2026-07-26", root, () => report);
    assert.equal(result.ok, true);
    assert.match(path.basename(result.paths.finalPdf), /^cv-beta-person-018-/);
  });
});

test("POST /api/profile merges into the override profile and leaves the default alone", async () => {
  await withProfiles(async ({ a, b }) => {
    const response = await updateProfile(post("profile", { name: "Gamma Person" }));
    assert.equal(response.status, 200);
    assert.equal(yaml.load(readFileSync(b, "utf8")).candidate.full_name, "Gamma Person");
    assert.equal(readFileSync(a, "utf8"), PROFILE_A);
  });
});

test("POST /api/profile creates the override profile from the example when it does not exist yet", async () => {
  await withProfiles(
    async ({ a, b }) => {
      const response = await updateProfile(post("profile", { name: "Gamma Person" }));
      assert.equal(response.status, 200);
      assert.equal(existsSync(b), true);
      assert.equal(yaml.load(readFileSync(b, "utf8")).candidate.full_name, "Gamma Person");
      assert.equal(readFileSync(a, "utf8"), PROFILE_A);
    },
    { writeB: false },
  );
});

test("POST /api/profile refuses to overwrite a malformed override profile", async () => {
  await withProfiles(async ({ a, b }) => {
    writeFileSync(b, "candidate: [broken\n");
    const response = await updateProfile(post("profile", { name: "Gamma Person" }));
    assert.equal(response.status, 409);
    assert.equal(readFileSync(b, "utf8"), "candidate: [broken\n");
    assert.equal(readFileSync(a, "utf8"), PROFILE_A);
  });
});

test("GET /api/followups/cadence reads the override profile", async () => {
  await withProfiles(async () => {
    const body = await (await readCadence()).json();
    assert.equal(body.overrides.applied_first_days, 2);
  });
});

test("POST /api/followups/cadence merges into the override profile and leaves the default alone", async () => {
  await withProfiles(async ({ a, b }) => {
    const response = await updateCadence(post("followups/cadence", { applied_first_days: 9 }));
    assert.equal(response.status, 200);
    const written = yaml.load(readFileSync(b, "utf8"));
    assert.equal(written.followup_cadence.applied_first_days, 9);
    assert.equal(written.candidate.full_name, "Beta Person");
    assert.equal(readFileSync(a, "utf8"), PROFILE_A);
  });
});

test("POST /api/followups/cadence refuses to overwrite a malformed override profile", async () => {
  await withProfiles(async ({ a, b }) => {
    writeFileSync(b, "- not\n- a mapping\n");
    const response = await updateCadence(post("followups/cadence", { applied_first_days: 9 }));
    assert.equal(response.status, 409);
    assert.equal(readFileSync(b, "utf8"), "- not\n- a mapping\n");
    assert.equal(readFileSync(a, "utf8"), PROFILE_A);
  });
});

test("doctorState does not report the profile missing when CAREER_OPS_PROFILE names an existing file", async () => {
  await withProfiles(({ root, a }) => {
    writeFileSync(path.join(root, "cv.md"), "# CV\n");
    mkdirSync(path.join(root, "modes"));
    writeFileSync(path.join(root, "modes", "_profile.md"), "# profile\n");
    writeFileSync(path.join(root, "portals.yml"), "companies: []\n");
    rmSync(a);
    const state = doctorState({ applications: [], inbox: [] });
    assert.deepEqual(state.missing, []);
    assert.equal(state.onboardingNeeded, false);
  });
});

test("doctorState still reports the profile missing when the override file does not exist", async () => {
  await withProfiles(
    ({ root, a }) => {
      writeFileSync(path.join(root, "cv.md"), "# CV\n");
      mkdirSync(path.join(root, "modes"));
      writeFileSync(path.join(root, "modes", "_profile.md"), "# profile\n");
      writeFileSync(path.join(root, "portals.yml"), "companies: []\n");
      rmSync(a);
      assert.deepEqual(doctorState({ applications: [], inbox: [] }).missing, ["config/profile.yml"]);
    },
    { writeB: false },
  );
});

test("readFollowupsEnabled reads the override profile", async () => {
  await withProfiles(() => {
    assert.equal(readFollowupsEnabled(), false);
  });
});
