// tests/tracker-delete-backup.test.mjs — `tracker.mjs delete` backs the tracker
// up before it removes a row.
//
// Every other tracker writer leaves a `.bak` of what it replaced
// (normalize-statuses, dedup-tracker, fix-report-links, and this script's own
// `export --out`). `delete` did not, and it is the one that cannot be redone: the
// row's status, report link and notes exist nowhere else, so a delete of the
// wrong number was unrecoverable.
//
// Each case runs the real CLI against its own temp tracker and asserts on the
// files afterwards, because the bytes left on disk are what the user can restore.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 41 | 2026-09-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [41](reports/041-acme-2026-09-01.md) | keep |',
  '| 42 | 2026-09-02 | Beta | Data Analyst | 3.9/5 | Interview | ✅ | [42](reports/042-beta-2026-09-02.md) | onsite booked |',
  '',
].join('\n');

function sandbox(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-delete-backup-')));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, TRACKER);
  const cli = (trackerPath, ...args) => {
    const r = spawnSync(NODE, [join(ROOT, 'tracker.mjs'), 'delete', ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_TRACKER: trackerPath, CAREER_OPS_TRACKER_DB: join(dir, 'applications.db') },
    });
    // Spread the real result so describeSpawn() can reach stdout, stderr, signal
  // and error. Returning only { status, all } printed "(empty)" for both
  // streams where r.all used to show the output (#5386), and it would also
  // hide a kill from exitedNonZero(), which reads signal and error.
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  try { return fn({ dir, tracker, cli }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

ok('delete --num 42 removes the row and leaves a .bak of the pre-delete tracker', () => sandbox(({ tracker, cli }) => {
  const r = cli(tracker, '--num', '42');
  assert.equal(r.status, 0, describeSpawn(r));
  const after = readFileSync(tracker, 'utf-8');
  assert.ok(!after.includes('| 42 |'), 'row 42 is still in the tracker');
  assert.ok(after.includes('| 41 | 2026-09-01 | Acme |'), 'row 41 was lost');
  assert.ok(existsSync(`${tracker}.bak`), 'no .bak was written');
  assert.equal(readFileSync(`${tracker}.bak`, 'utf-8'), TRACKER, 'the .bak is not the pre-delete tracker');
  assert.ok(r.all.includes(`${tracker}.bak`), 'the output does not say where the backup is');
}));

ok('restoring the .bak brings the deleted row back byte for byte', () => sandbox(({ tracker, cli }) => {
  cli(tracker, '--num', '42');
  writeFileSync(tracker, readFileSync(`${tracker}.bak`));
  assert.equal(readFileSync(tracker, 'utf-8'), TRACKER);
}));

ok('a delete that finds no such row writes no .bak', () => sandbox(({ tracker, cli }) => {
  const r = cli(tracker, '--num', '99');
  assert.equal(r.status, 1, r.all);
  assert.match(r.all, /No application numbered 99/);
  assert.equal(readFileSync(tracker, 'utf-8'), TRACKER, 'the tracker was modified');
  assert.ok(!existsSync(`${tracker}.bak`), 'a .bak was written although nothing was deleted');
}));

ok('delete --dry-run writes no .bak', () => sandbox(({ tracker, cli }) => {
  const r = cli(tracker, '--num', '42', '--dry-run');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.all, /Would remove application 42/);
  assert.equal(readFileSync(tracker, 'utf-8'), TRACKER, 'the tracker was modified');
  assert.ok(!existsSync(`${tracker}.bak`), 'a preview wrote a .bak');
}));

ok('a second delete replaces the .bak with the tracker as it was before THAT delete', () => sandbox(({ tracker, cli }) => {
  cli(tracker, '--num', '42');
  const afterFirst = readFileSync(tracker, 'utf-8');
  const r = cli(tracker, '--num', '41');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.equal(readFileSync(`${tracker}.bak`, 'utf-8'), afterFirst);
}));

// A tracker reached through a symlink (a CAREER_OPS_TRACKER pointing at a link)
// keeps its backup beside the real file, not beside the link. Same choice, for
// the same reason, as fix-report-links.mjs: the backup is written from the bytes
// read inside the lock, next to the path the transaction actually replaces.
ok('a symlinked tracker gets its .bak beside the real file', () => sandbox(({ dir, tracker, cli }) => {
  const link = join(dir, 'linked.md');
  try { symlinkSync(tracker, link); } catch { return; } // Windows without the symlink privilege
  const r = cli(link, '--num', '42');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.ok(existsSync(`${tracker}.bak`), 'no .bak beside the real tracker');
  assert.equal(readFileSync(`${tracker}.bak`, 'utf-8'), TRACKER);
  assert.ok(!existsSync(`${link}.bak`), 'a .bak was written beside the symlink');
}));
