// scan.mjs must refuse a posted-date window whose lower bound is after
// --posted-before.
//
// Each bound is validated as a real date on its own, but a lower bound
// (--posted-after, or the date --since resolves to) past --posted-before leaves
// a window no dated posting can fall in. Before the check the scan ran anyway
// and dropped every dated posting under an ordinary "Filtered by posted date"
// count, the silent "no jobs matched" result the date checks exist to prevent.
//
// The CLI is spawned against an empty temporary data root: the window check
// runs before any config is read, so a refused window exits with its own
// message, and a run that gets past it stops at once on the missing
// portals.yml instead of scanning or touching a real data root.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const SCRIPT = join(ROOT, 'scan.mjs');
const dataRoot = mkdtempSync(join(tmpdir(), 'co-scan-window-'));
after(() => rmSync(dataRoot, { recursive: true, force: true }));

function scan(...args) {
  // scan.mjs reads CAREER_OPS_PORTALS before the data root, so a value set in
  // the caller's shell would send the run to a real portals.yml.
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  delete env.CAREER_OPS_PORTALS;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    cwd: ROOT,
    env,
  });
}

const WINDOW_ERROR = /is later than --posted-before/;

test('--posted-after later than --posted-before is refused, naming both dates', () => {
  const r = scan('--posted-after', '2026-08-01', '--posted-before', '2026-07-01');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--posted-after 2026-08-01 is later than --posted-before 2026-07-01/);
});

test('the =value form is refused the same way', () => {
  const r = scan('--posted-after=2026-08-01', '--posted-before=2026-07-01');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--posted-after 2026-08-01 is later than --posted-before 2026-07-01/);
});

test('a --since window past --posted-before is refused, with the date it resolved to', () => {
  // --since counts back from today, so any long-past --posted-before is behind it.
  const r = scan('--since', '7', '--posted-before', '2000-01-01');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since 7 \(from \d{4}-\d{2}-\d{2}\) is later than --posted-before 2000-01-01/);
});

test('a one-day window (both bounds the same date) is not refused', () => {
  // Both bounds are inclusive, so this window holds a day of postings. The run
  // gets past the window check and stops on the empty data root's missing
  // portals.yml, which proves it was not refused for some other reason.
  const r = scan('--posted-after', '2026-07-01', '--posted-before', '2026-07-01');
  assert.doesNotMatch(r.stderr, WINDOW_ERROR);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /portals\.yml not found/);
});
