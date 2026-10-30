// tests/reply-watch-delegates-status.test.mjs — reply-watch writes no status
// of its own (#5536).
//
// Every accepted update goes through set-status.mjs, so the status hooks
// (ledger row, JD archive on Interview, follow-up seeding on Applied) run for
// it as they do for any other status change. A tracker transaction or a
// Status-cell edit reappearing in reply-watch.mjs would be a second status
// writer, and the next hook added to set-status would skip it. The behaviour
// is covered end to end in tests/status-hooks-writers.test.mjs; this pins the
// boundary, the way test-all.mjs pins it for the dashboard's status writer.
//
// Run:  node --test tests/reply-watch-delegates-status.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const source = readFileSync(join(ROOT, 'reply-watch.mjs'), 'utf8');

test('reply-watch hands its writes to set-status.mjs with the row-scoped review guard', () => {
  assert.ok(source.includes("'set-status.mjs'"), 'reply-watch.mjs no longer spawns set-status.mjs');
  assert.ok(source.includes("'--expect-row'"), 'reply-watch.mjs no longer passes the reviewed row to set-status.mjs');
});

test('reply-watch has no tracker writer of its own', () => {
  for (const writer of ['openTrackerTransaction', 'acquireTrackerLock', 'writeFileAtomic', 'rebuildRow', 'appendLedgerRows']) {
    assert.ok(!source.includes(writer), `reply-watch.mjs uses ${writer}, so it writes the tracker or the ledger itself`);
  }
  assert.doesNotMatch(source, /\[\s*(?:colmap|COLMAP|COLS)\.status\s*\]\s*=/, 'reply-watch.mjs assigns a Status cell');
});
