import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FOLLOWUPS_NETWORK_ERROR, followupsAfterRefreshFailure } from "../../src/lib/followups-refresh.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const view = readFileSync(join(root, "src/components/followups/followups-view.tsx"), "utf8");

test("a failed follow-ups refresh keeps the list and names a network error", () => {
  const current = {
    available: true,
    metadata: { actionable: 1, urgent: 0, overdue: 1 },
    entries: [{ num: 12, company: "Fixture Co", role: "Analyst" }],
    upcoming: [],
  };
  const next = followupsAfterRefreshFailure(current);
  assert.equal(next.available, true);
  assert.equal(next.refreshFailed, true);
  assert.deepEqual(next.entries, current.entries);

  const first = followupsAfterRefreshFailure(null);
  assert.equal(first.available, true);
  assert.deepEqual(first.entries, []);
  assert.equal(first.refreshFailed, true);

  assert.doesNotMatch(FOLLOWUPS_NETWORK_ERROR, /followup-cadence|script/i);
  assert.match(view, /followupsAfterRefreshFailure/);
  assert.match(view, /FOLLOWUPS_NETWORK_ERROR/);
  assert.match(view, /!data\.available && !data\.refreshFailed/);
  assert.match(view, /refreshWithoutAList/);
  assert.match(view, /data\?\.refreshFailed && !meta && entries\.length === 0/);
  assert.doesNotMatch(view, /refreshFailed && filtered\.length === 0/);
});
