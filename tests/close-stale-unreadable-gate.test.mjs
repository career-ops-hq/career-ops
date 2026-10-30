// tests/close-stale-unreadable-gate.test.mjs — a skip gate that cannot be read
// is not a skip gate that passed.
//
// close-stale.mjs bulk-writes `Discarded` over long-silent `Applied` rows, and
// its header promises three protections. A candidate is SKIPPED when it has any
// later signal that somebody might still be answering:
//
//   active-interview   the company appears in data/active-interviews.md
//   status-log         data/status-log.tsv holds a transition after Applied
//   open-follow-up     data/follow-ups.md has a recent follow-up or a live pin
//
// All three are read through one helper, and each decides to skip a row by
// finding evidence INSIDE the file. "No evidence found" is therefore
// indistinguishable from "no file" — so when the helper answered '' for every
// read failure, an unreadable file did not stop the run. It switched the
// protection off and carried on closing rows.
//
// With --confirm that writes `Discarded` over applications the user is still
// following up on, or still interviewing for, which is the single outcome the
// script's own header says cannot happen. ENOENT is the only failure that
// honestly means '': a user who never logged a follow-up has no follow-ups
// file, and that absence is real information.
//
// The gate files are made DIRECTORIES to produce a read failure. EISDIR
// reproduces as a non-root user on every platform the suite runs on, which
// chmod 000 does not — the same trick web/tests/lib/whats-new-read-failure uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'close-stale.mjs');
const TODAY = '2026-10-24';
const OLD = '2026-06-01';   // far past any --days window used here

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|';
const ROW = `| 4 | ${OLD} | Pinged Co | Engineer | 4.0/5 | Applied | ✅ | [4](reports/004-x.md) |  |`;
const TRACKER = ['# Applications Tracker', '', HEADER, SEP, ROW, ''].join('\n');

// A follow-up two weeks before TODAY: inside --days 60, so row 4 is protected.
const FOLLOWUPS = ['- 2026-10-10 · #4 Pinged Co — sent a nudge', ''].join('\n');

function makeRoot({ followups = FOLLOWUPS, breakFile = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'close-stale-gate-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, TRACKER);
  if (followups !== null) writeFileSync(join(root, 'data', 'follow-ups.md'), followups);
  // A directory where a file belongs: readFileSync answers EISDIR.
  if (breakFile) {
    rmSync(join(root, 'data', breakFile), { recursive: true, force: true });
    mkdirSync(join(root, 'data', breakFile), { recursive: true });
  }
  return { root, tracker, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, '--today', TODAY, '--days', '60', ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_FOLLOWUPS: '',
    },
  });
}

const withRoot = (opts, fn) => {
  const fx = makeRoot(opts);
  try { return fn(fx); } finally { fx.cleanup(); }
};

test('the open-follow-up gate really does protect the row', () => {
  // The premise. Without this the rest proves nothing: if row 4 were closed
  // even with a readable follow-ups file, an unreadable one changing nothing
  // would be unremarkable.
  withRoot({}, ({ root, tracker }) => {
    const before = readFileSync(tracker, 'utf-8');
    const r = run(root, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r, 'a readable gate file is an ordinary run'));
    assert.equal(readFileSync(tracker, 'utf-8'), before,
      'row 4 has a follow-up inside the window, so it must still be Applied');
  });
});

for (const file of ['follow-ups.md', 'active-interviews.md', 'status-log.tsv']) {
  test(`an unreadable ${file} ends the run instead of closing rows`, () => {
    withRoot({ breakFile: file }, ({ root, tracker }) => {
      const before = readFileSync(tracker, 'utf-8');
      const r = run(root, ['--confirm']);

      assert.ok(exitedNonZero(r), describeSpawn(r, `an unreadable ${file} must stop the run`));
      // The message has to name the file. "something went wrong" would leave the
      // user with a half-understood refusal on a destructive command.
      assert.match(`${r.stdout}${r.stderr}`, new RegExp(file.replace('.', '\\.')),
        'the refusal must name the file it could not read');
      // THE POINT: nothing was written. Before the fix the run proceeded with
      // that protection switched off and rewrote the row to Discarded.
      assert.equal(readFileSync(tracker, 'utf-8'), before,
        `the tracker must be untouched when the ${file} gate could not be evaluated`);
    });
  });
}

test('an absent follow-ups file is still an ordinary empty gate, not an error', () => {
  // The other half, and the reason this is not just "throw on any read error".
  // A user who has never logged a follow-up has no file, the gate genuinely has
  // nothing to say, and the run must proceed — so row 4 closes here.
  withRoot({ followups: null }, ({ root, tracker }) => {
    const r = run(root, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r, 'a missing follow-ups file is not a failure'));
    const after = readFileSync(tracker, 'utf-8');
    assert.match(after, /\|\s*4\s*\|[^\n]*Discarded/,
      'with no follow-up evidence the stale row is closed, which is the whole job');
  });
});
