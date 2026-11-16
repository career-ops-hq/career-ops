import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScheduledSelection } from "../../src/lib/scheduled-source-selection.mjs";

const id = "11111111-1111-4111-8111-111111111111";

test("website-only scheduled selections are valid without silently enabling ATS sources", () => {
  assert.doesNotThrow(() => validateScheduledSelection("full", { ats: [], websiteIds: [id] }, { ats: [], websiteIds: [id] }));
  assert.throws(() => validateScheduledSelection("full", { ats: [], websiteIds: [] }, { ats: [], websiteIds: [] }), /Select an ATS source or a saved website/);
  assert.doesNotThrow(() => validateScheduledSelection("portals", { ats: [], websiteIds: [] }, { ats: [], websiteIds: [] }));
  assert.doesNotThrow(() => validateScheduledSelection("full", { ats: [], websiteIds: [] }, undefined));
});

test("malformed website identifiers are rejected rather than discarded during save", () => {
  for (const value of [["invalid"], "not an array", Array(21).fill(id)]) {
    assert.throws(() => validateScheduledSelection("full", { ats: ["lever"], websiteIds: [] }, { websiteIds: value }), /valid saved websites/);
  }
  assert.throws(() => validateScheduledSelection("full", {}, []), /valid search filters/);
  assert.throws(() => validateScheduledSelection("full", { ats: [], websiteIds: [id] }, { ats: ["unknown"], websiteIds: [id] }), /valid ATS sources/);
});
