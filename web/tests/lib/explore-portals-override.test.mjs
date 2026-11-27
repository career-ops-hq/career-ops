// The Explorer reads portals.yml where the scanner does: CAREER_OPS_PORTALS
// when set, else <root>/portals.yml (#7870). Before the fix, seedExploreFilters
// and writeTempPortals joined <root>/portals.yml by hand. With the override set
// and no file at the root, seeding fell back to defaults and the ENOENT left
// ad hoc scans without the saved workplace_policy.
//
// Run:  node --experimental-strip-types --test tests/lib/explore-portals-override.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import "../helpers/web-ts-alias-loader.mjs";

const { seedExploreFilters, writeTempPortals, cleanupTempPortals } = await import("../../src/lib/core/portals.ts");

const POLICY = { onsite_locations: ["Barcelona"], remote_countries: ["Spain"] };
const OVERRIDE = yaml.dump({
  title_filter: { positive: ["Override Role"] },
  location_filter: { allow: ["Spain"], workplace_policy: POLICY },
});
const CHIPS = { positive: ["Engineer"], negative: [], allow: [], block: [], alwaysAllow: [], blockHard: [] };

/** A data root with no portals.yml, and CAREER_OPS_PORTALS naming a file outside it. */
function withOverride(fn) {
  const temp = realpathSync(mkdtempSync(path.join(tmpdir(), "career-ops-explore-override-")));
  const root = path.join(temp, "root");
  const file = path.join(temp, "elsewhere-portals.yml");
  writeFileSync(file, OVERRIDE);
  const saved = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_PORTALS: process.env.CAREER_OPS_PORTALS, CAREER_OPS_PROFILE: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_PORTALS = file;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

test("seedExploreFilters seeds from CAREER_OPS_PORTALS", () => {
  withOverride(() => {
    const { filters, seededFrom } = seedExploreFilters();
    assert.deepEqual(filters.positive, ["Override Role"]);
    assert.deepEqual(filters.allow, ["Spain"]);
    assert.deepEqual(seededFrom, ["portals.yml"]);
  });
});

test("writeTempPortals carries workplace_policy from CAREER_OPS_PORTALS", () => {
  withOverride(() => {
    const file = writeTempPortals(CHIPS);
    try {
      assert.deepEqual(yaml.load(readFileSync(file, "utf8")).location_filter.workplace_policy, POLICY);
    } finally {
      cleanupTempPortals(file);
    }
  });
});
