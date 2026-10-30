import { test } from "node:test";
import assert from "node:assert/strict";
import { followupsEnabledFromProfile } from "../../src/lib/followups-setting.mjs";

test("follow-ups stay on unless the profile says enabled: false", () => {
  assert.equal(followupsEnabledFromProfile(undefined), true);
  assert.equal(followupsEnabledFromProfile(null), true);
  assert.equal(followupsEnabledFromProfile({}), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: null }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: true } }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: "false" } }), true);
  assert.equal(followupsEnabledFromProfile({ follow_ups: { enabled: false } }), false);
});
