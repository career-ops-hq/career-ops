// tests/closing-soon-clashes.test.mjs — closing-soon.mjs --clashes flags
// interview days where closing dates pile up (#5737). Synthetic fixtures only.
//
// Run:  node --test tests/closing-soon-clashes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { computeClosingSoon, computeClashes, resolveStatusFilter } =
  await import(pathToFileURL(join(ROOT, 'closing-soon.mjs')).href);

const TODAY = new Date('2026-10-17T00:00:00Z');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | — | closes 2026-10-20 |',
  '| 2 | 2026-10-01 | Globex | Designer | 4.0/5 | Evaluated | ❌ | — | closes 2026-10-21 |',
  '| 3 | 2026-10-01 | Initech | Writer | 4.1/5 | Evaluated | ❌ | — | closes 2026-10-21 |',
  '| 4 | 2026-10-01 | Umbrella | Planner | 4.3/5 | Evaluated | ❌ | — | closes 2026-10-22 |',
  '| 5 | 2026-10-01 | Hooli | Lead | 4.4/5 | Evaluated | ❌ | — | closes 2026-10-25 |',
  '',
].join('\n');

const INTERVIEWS = [
  '# Active Interviews',
  '',
  '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
  '|---|---|---|---|---|---|---|',
  '| Wonka | Coordinator | Panel | 2026-10-21 14:30 EST | Pat | Scheduled | |',
  '| Stark | Engineer | Phone | 2026-10-24 10:00 | Sam | Scheduled | |',
  '| Wayne | Manager | Panel | 2026-10-21 09:00 | Lee | ❌ Rejected | |',
  '| Pied | Coder | Phone | 2026-10-21 | Kim | Ghosted | |',
  '| Soylent | Chef | Phone | Tuesday afternoon | Ana | Scheduled | |',
  '| Oscorp | Analyst | Phone | 2026-02-30 | Bo | Scheduled | |',
  '| Cyberdyne | Tester | Phone | 2026-12-01 | Cy | Scheduled | |',
  '| Gringotts | Teller | Phone | 2026-10-10 | Gob | Scheduled | |',
  '',
].join('\n');

const closing = () =>
  computeClosingSoon(TRACKER, { today: TODAY, within: 14, statuses: resolveStatusFilter('Evaluated') }).closingSoon;

test('counts closings on the interview day and the day before', () => {
  const clashes = computeClashes(closing(), INTERVIEWS, { today: TODAY, within: 14 });
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].date, '2026-10-21');
  assert.deepEqual(clashes[0].interview, { company: 'Wonka', role: 'Coordinator', time: '2026-10-21 14:30 EST' });
  assert.deepEqual(clashes[0].closing.map(r => r.num), [1, 2, 3]);
});

test('--clash-min raises and lowers the threshold', () => {
  assert.equal(computeClashes(closing(), INTERVIEWS, { today: TODAY, within: 14, clashMin: 4 }).length, 0);
  assert.equal(computeClashes(closing(), INTERVIEWS, { today: TODAY, within: 14, clashMin: 3 }).length, 1);
  // Stark on 10-24: only Hooli (10-25) is outside day/eve, none close 10-23/24.
  const one = computeClashes(closing(), INTERVIEWS, { today: TODAY, within: 14, clashMin: 1 });
  assert.deepEqual(one.map(c => c.date), ['2026-10-21']);
});

test('terminal statuses (emoji prefix tolerated), unreadable and out-of-window dates are skipped', () => {
  // Wayne (❌ Rejected) and Pied (Ghosted) are also on 10-21 / would add nothing;
  // check them in isolation with a threshold of 1.
  const only = (rows) => [
    '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  const opts = { today: TODAY, within: 14, clashMin: 1 };
  for (const status of ['❌ Rejected', 'Declined', 'Ghosted', '✅ Done']) {
    assert.deepEqual(computeClashes(closing(), only([`| A | B | R | 2026-10-21 | X | ${status} | |`]), opts), [], status);
  }
  for (const when of ['Tuesday afternoon', '2026-02-30', '2026-12-01', '2026-10-10', '']) {
    assert.deepEqual(computeClashes(closing(), only([`| A | B | R | ${when} | X | Scheduled | |`]), opts), [], when);
  }
  assert.equal(computeClashes(closing(), only(['| A | B | R | 2026-10-21 | X | Scheduled | |']), opts).length, 1);
});

test('missing or empty interviews content yields no clashes', () => {
  assert.deepEqual(computeClashes(closing(), '', { today: TODAY }), []);
  assert.deepEqual(computeClashes(closing(), undefined, { today: TODAY }), []);
});

function sandbox() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'closing-clash-root-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'closing-clash-cwd-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), TRACKER);
  writeFileSync(join(dataRoot, 'data', 'active-interviews.md'), INTERVIEWS);
  return { dataRoot, decoyCwd };
}

function cleanup(box) {
  rmSync(box.dataRoot, { recursive: true, force: true });
  rmSync(box.decoyCwd, { recursive: true, force: true });
}

function run(args, { dataRoot, decoyCwd }) {
  return spawnSync(process.execPath, [join(ROOT, 'closing-soon.mjs'), ...args], {
    cwd: decoyCwd,
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: '' },
  });
}

test('CLI: without --clashes the output has no clashes key and ignores the interviews file', () => {
  const box = sandbox();
  try {
    const plain = run(['--today', '2026-10-17', '--within', '14'], box);
    assert.equal(plain.status, 0, describeSpawn(plain));
    assert.equal('clashes' in JSON.parse(plain.stdout), false);
    assert.ok(!/clash/i.test(run(['--today', '2026-10-17', '--summary'], box).stdout));
    rmSync(join(box.dataRoot, 'data', 'active-interviews.md'));
    const without = run(['--today', '2026-10-17', '--within', '14'], box);
    assert.equal(without.stdout, plain.stdout);
  } finally {
    cleanup(box);
  }
});

test('CLI: --clashes adds the group and a one-line hint in --summary', () => {
  const box = sandbox();
  try {
    const r = run(['--today', '2026-10-17', '--within', '14', '--clashes'], box);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.clashes.length, 1);
    assert.equal(out.clashes[0].date, '2026-10-21');
    assert.equal(out.closingSoon.length, 5);

    const none = JSON.parse(run(['--today', '2026-10-17', '--within', '14', '--clashes', '--clash-min', '4'], box).stdout);
    assert.deepEqual(none.clashes, []);

    const s = run(['--today', '2026-10-17', '--within', '14', '--clashes', '--summary'], box);
    assert.equal(s.status, 0, describeSpawn(s));
    assert.match(s.stdout, /Interview-day clashes: 1/);
    assert.match(s.stdout, /submit these before the interview/);
  } finally {
    cleanup(box);
  }
});

test('CLI: --interviews overrides the path; a missing file warns and yields no clashes', () => {
  const box = sandbox();
  try {
    const missing = JSON.parse(run(['--today', '2026-10-17', '--clashes', '--interviews', join(box.dataRoot, 'nope.md')], box).stdout);
    assert.deepEqual(missing.clashes, []);
    assert.ok(missing.warnings.some(w => /No interviews file/.test(w)));
  } finally {
    cleanup(box);
  }
});

test('CLI: a relative --interviews path is resolved from the data root, not the cwd', () => {
  const box = sandbox();
  try {
    const args = ['--today', '2026-10-17', '--within', '14', '--clashes'];
    const base = JSON.parse(run(args, box).stdout);
    const rel = JSON.parse(run([...args, '--interviews', 'data/active-interviews.md'], box).stdout);
    assert.deepEqual(rel.clashes, base.clashes);
    assert.deepEqual(rel.warnings, base.warnings);
    const abs = JSON.parse(run([...args, '--interviews', join(box.dataRoot, 'data', 'active-interviews.md')], box).stdout);
    assert.deepEqual(abs.clashes, base.clashes);
  } finally {
    cleanup(box);
  }
});

test('CLI: an --interviews path that exists but cannot be read (a directory) warns instead of crashing', () => {
  const box = sandbox();
  try {
    const r = run(['--today', '2026-10-17', '--clashes', '--interviews', join(box.dataRoot, 'data')], box);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.clashes, []);
    assert.ok(out.warnings.some(w => /Cannot read interviews file/.test(w)));
  } finally {
    cleanup(box);
  }
});

test('CLI: flag validation', () => {
  const box = sandbox();
  try {
    for (const args of [['--clash-min', '2'], ['--interviews', 'x.md'], ['--clashes', '--clash-min', '0'], ['--clashes', '--clash-min', 'abc'], ['--clashes', '--clash-min', '-1']]) {
      const r = run(['--today', '2026-10-17', ...args], box);
      assert.ok(exitedNonZero(r), describeSpawn(r, args.join(' ')));
    }
  } finally {
    cleanup(box);
  }
});
