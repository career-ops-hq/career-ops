/**
 * followup-view.test.mjs — regression tests for pickNextUpcoming()
 * (web/src/lib/core/followup-view.mjs, PR #2157 CodeRabbit fixup).
 *
 * pickNextUpcoming() used to rank candidates by `daysUntilNext ?? Infinity`.
 * When daysUntilNext is missing/null on more than one eligible entry (e.g. a
 * stale snapshot that has nextFollowupDate but never recomputed the derived
 * days-until field), every such entry ties at Infinity and Array.sort's
 * stability then just preserves input order -- NOT the actually-nearer date.
 * This reproduces that with a stable-sort tie: a far entry placed BEFORE a
 * near entry, both missing daysUntilNext, must still yield the near one.
 *
 * web/ lives deliberately OUTSIDE the auto-updater's world (its own
 * release-please component; see validate-system-paths-coverage.mjs
 * EXCLUDE_PREFIXES) -- a core-only install has no web/ tree, so this test
 * warns rather than fails when web/ is absent, matching the HAS_WEB pattern
 * in test/apply-cv-resolver.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FOLLOWUP_VIEW = join(ROOT, 'web', 'src', 'lib', 'core', 'followup-view.mjs');
const HAS_WEB = existsSync(FOLLOWUP_VIEW);

if (!HAS_WEB) {
  test('followup-view: skipped — web/ not present (core-only install; web/ is excluded from the auto-updater by design)', () => {});
} else {
  const { pickNextUpcoming } = await import(pathToFileURL(FOLLOWUP_VIEW).href);

  test('pickNextUpcoming: picks the actually-nearer date, not just the first entry, when daysUntilNext is missing on both candidates', () => {
    const far = { urgency: 'waiting', nextFollowupDate: '2026-12-01', daysUntilNext: null };
    const near = { urgency: 'waiting', nextFollowupDate: '2026-08-01', daysUntilNext: null };
    // far placed first -- a comparator that treats both as tied (Infinity)
    // would return far here under a stable sort, which is the bug.
    const result = pickNextUpcoming([far, near]);
    assert.equal(result, near);
  });

  test('pickNextUpcoming: an unparseable nextFollowupDate sorts after a valid one', () => {
    const invalid = { urgency: 'waiting', nextFollowupDate: 'not-a-date', daysUntilNext: null };
    const valid = { urgency: 'waiting', nextFollowupDate: '2026-08-01', daysUntilNext: 5 };
    assert.equal(pickNextUpcoming([invalid, valid]), valid);
    assert.equal(pickNextUpcoming([valid, invalid]), valid);
  });

  test('pickNextUpcoming: returns null when nothing is upcoming', () => {
    assert.equal(pickNextUpcoming([]), null);
    assert.equal(pickNextUpcoming([{ urgency: 'overdue', nextFollowupDate: '2026-01-01' }]), null);
  });
}
