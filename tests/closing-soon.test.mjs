// tests/closing-soon.test.mjs — closing-soon.mjs reads closing dates out of
// tracker Notes (and jds/ captures) and never writes anything (#5412).
//
// Run:  node --test tests/closing-soon.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { extractClosingDates, computeClosingSoon, htmlToText, resolveStatusFilter, loadStateLookup } =
  await import(pathToFileURL(join(ROOT, 'closing-soon.mjs')).href);

const TODAY = new Date('2026-10-17T00:00:00Z');
const dates = (text, today = TODAY) => extractClosingDates(text, today).dates.map(d => d.date);

test('ISO date after each marker word', () => {
  for (const marker of ['closes', 'closing date', 'closing', 'deadline', 'apply by', 'Closes:', 'DEADLINE -', 'closing date: ', 'closes on']) {
    assert.deepEqual(dates(`${marker} 2026-10-22`), ['2026-10-22'], marker);
  }
});

test('Mon D, YYYY in abbreviated, full, ordinal and no-comma spellings', () => {
  assert.deepEqual(dates('closes Nov 4, 2026'), ['2026-11-04']);
  assert.deepEqual(dates('deadline November 4 2026'), ['2026-11-04']);
  assert.deepEqual(dates('apply by Sept. 9th, 2026'), ['2026-09-09']);
  assert.deepEqual(dates('closes on Fri Oct 23, 2026'), ['2026-10-23']);
});

test('Mon D uses this year, and rolls to next year only past the grace window', () => {
  assert.deepEqual(dates('deadline Nov 4'), ['2026-11-04']);
  // Passed 17 days ago: still this year (overdue), not next year.
  assert.deepEqual(dates('deadline Sep 30'), ['2026-09-30']);
  const december = new Date('2026-12-20T00:00:00Z');
  assert.deepEqual(dates('closes Jan 5', december), ['2027-01-05']);
  assert.deepEqual(dates('closes Dec 1', december), ['2026-12-01']);
  // Time of day after the date does not make it malformed.
  assert.deepEqual(dates('deadline Nov 4 11:59pm'), ['2026-11-04']);
});

test('MM/DD/YYYY only when unambiguous', () => {
  assert.deepEqual(dates('closes 10/22/2026'), ['2026-10-22']);
  assert.deepEqual(dates('closes 03/03/2026'), ['2026-03-03']);
  for (const text of ['closes 04/05/2026', 'closes 22/10/2026', 'closes 10/22', 'closes 10/22/26']) {
    const r = extractClosingDates(text, TODAY);
    assert.deepEqual(r.dates, [], text);
    assert.equal(r.unparsed.length, 1, text);
  }
});

test('markers without a readable date are unparsed, never guessed', () => {
  for (const text of ['deadline TBD', 'closes 4 Nov 2026', 'closing date 2026-02-31', 'deadline Feb 30', 'apply by soon']) {
    const r = extractClosingDates(text, TODAY);
    assert.deepEqual(r.dates, [], text);
    assert.equal(r.unparsed.length, 1, text);
  }
  // A bare "closing" with no date-shaped text is ordinary prose.
  assert.deepEqual(extractClosingDates('closing the loop with recruiter', TODAY), { dates: [], unparsed: [] });
  assert.deepEqual(extractClosingDates('posted 2026-10-22, no marker', TODAY), { dates: [], unparsed: [] });
});

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | closes 2026-10-22 |',
  '| 2 | 2026-10-01 | Globex | Designer | 4.0/5 | Evaluated | ❌ | — | deadline Oct 19 |',
  '| 3 | 2026-10-01 | Initech | Writer | 4.1/5 | Evaluated | ❌ | — | closes 2026-12-01 |',
  '| 4 | 2026-10-01 | Umbrella | Planner | 4.3/5 | Evaluated | ❌ | — | closes 2026-10-10 |',
  '| 5 | 2026-10-01 | Hooli | Lead | 4.4/5 | Evaluated | ❌ | — | deadline TBD |',
  '| 6 | 2026-10-01 | Stark | Engineer | 4.5/5 | Applied | ✅ | — | closes 2026-10-18 |',
  '| 7 | 2026-10-01 | Wayne | Manager | 4.0/5 | **Evaluated** | ❌ | — | apply by 10/24/2026 |',
  '| 8 | 2026-10-01 | Pied | Coder | 4.0/5 | Evaluated | ❌ | — | closes 2026-10-17 |',
  '| 9 | 2026-10-01 | Soylent | Chef | 4.0/5 | Evaluated | ❌ | — | no date here |',
  '',
].join('\n');

const evaluated = resolveStatusFilter('Evaluated');

test('window, ordering, overdue group and unparsed list', () => {
  const r = computeClosingSoon(TRACKER, { today: TODAY, within: 7, statuses: evaluated });
  assert.deepEqual(r.closingSoon.map(x => [x.num, x.closes, x.daysLeft]), [
    [8, '2026-10-17', 0],
    [2, '2026-10-19', 2],
    [1, '2026-10-22', 5],
    [7, '2026-10-24', 7],
  ]);
  assert.deepEqual(r.overdue.map(x => [x.num, x.daysOverdue]), [[4, 7]]);
  assert.equal(r.overdue[0].daysLeft, undefined);
  assert.deepEqual(r.unparsed.map(x => x.num), [5]);
  assert.equal(r.rowsChecked, 8);
});

test('--within widens and narrows the window', () => {
  assert.equal(computeClosingSoon(TRACKER, { today: TODAY, within: 0, statuses: evaluated }).closingSoon.length, 1);
  const wide = computeClosingSoon(TRACKER, { today: TODAY, within: 45, statuses: evaluated });
  assert.ok(wide.closingSoon.some(x => x.num === 3));
});

test('status filtering, including multiple states', () => {
  const applied = computeClosingSoon(TRACKER, { today: TODAY, within: 7, statuses: resolveStatusFilter('applied') });
  assert.deepEqual(applied.closingSoon.map(x => x.num), [6]);
  const both = computeClosingSoon(TRACKER, { today: TODAY, within: 7, statuses: resolveStatusFilter('Evaluated, Applied') });
  assert.ok(both.closingSoon.some(x => x.num === 6) && both.closingSoon.some(x => x.num === 1));
  assert.throws(() => resolveStatusFilter('Bogus'), /Unknown status/);
  assert.ok(loadStateLookup().has('evaluated'));
});

test('a different today changes the result deterministically', () => {
  const later = new Date('2026-10-30T00:00:00Z');
  const r = computeClosingSoon(TRACKER, { today: later, within: 7, statuses: evaluated });
  assert.deepEqual(r.closingSoon, []);
  assert.ok(r.overdue.some(x => x.num === 1));
});

test('several dates in one row surface the earliest', () => {
  const md = TRACKER.replace('closes 2026-10-22', 'closes 2026-10-25, extended: deadline 2026-10-20');
  const r = computeClosingSoon(md, { today: TODAY, within: 7, statuses: evaluated });
  const row = r.closingSoon.find(x => x.num === 1);
  assert.equal(row.closes, '2026-10-20');
  assert.deepEqual(row.allDates, ['2026-10-20', '2026-10-25']);
});

function sandbox() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'closing-soon-root-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'closing-soon-cwd-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'jds'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), TRACKER);
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

test('CLI: JSON by default from the data root, and it writes nothing', () => {
  const box = sandbox();
  try {
    const before = readFileSync(join(box.dataRoot, 'data', 'applications.md'), 'utf-8');
    const r = run(['--today', '2026-10-17'], box);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.metadata.within, 7);
    assert.deepEqual(out.metadata.statuses, ['Evaluated']);
    assert.deepEqual(out.closingSoon.map(x => x.num), [8, 2, 1, 7]);
    assert.equal(out.overdue.length, 1);
    assert.equal(out.unparsed.length, 1);
    assert.equal(readFileSync(join(box.dataRoot, 'data', 'applications.md'), 'utf-8'), before);
    assert.deepEqual(readdirSync(join(box.dataRoot, 'data')), ['applications.md']);
    assert.deepEqual(readdirSync(box.dataRoot).sort(), ['data', 'jds']);
  } finally {
    cleanup(box);
  }
});

test('CLI: --summary prints a table and bad input exits non-zero', () => {
  const box = sandbox();
  try {
    const s = run(['--summary', '--today', '2026-10-17', '--within=3'], box);
    assert.equal(s.status, 0, describeSpawn(s));
    assert.match(s.stdout, /Closing within 3 day\(s\): 2/);
    assert.match(s.stdout, /Overdue/);
    for (const bad of [['--today', '2026-13-01'], ['--within', '-1'], ['--within', 'x'], ['--status', 'Bogus'], ['--json', '--summary']]) {
      assert.equal(run(bad, box).status, 2, bad.join(' '));
    }
    assert.equal(run(['--bogus'], box).status, 1);
  } finally {
    cleanup(box);
  }
});

test('CLI: a missing tracker is an empty report with a warning, not a failure', () => {
  const box = sandbox();
  try {
    rmSync(join(box.dataRoot, 'data', 'applications.md'));
    const r = run(['--today', '2026-10-17'], box);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.closingSoon.length, 0);
    assert.equal(out.warnings.length, 1);
  } finally {
    cleanup(box);
  }
});

test('captures: read only when Notes carry no marker, matched by report number and company', () => {
  const box = sandbox();
  try {
    const tracker = [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | no date typed |',
      '| 2 | 2026-10-01 | Globex | Designer | 4.0/5 | Evaluated | ❌ | [2](reports/002-globex-2026-10-01.md) | closes 2026-11-30 |',
      '| 3 | 2026-10-01 | Initech | Writer | 4.1/5 | Evaluated | ❌ | [3](reports/003-initech-2026-10-01.md) | no date typed |',
      '',
    ].join('\n');
    writeFileSync(join(box.dataRoot, 'data', 'applications.md'), tracker);
    writeFileSync(join(box.dataRoot, 'jds', '001-acme-analyst.md'), 'Great role.\n\nApplication deadline: October 21, 2026.\n');
    // Notes already carry a marker for row 2, so this capture is not consulted.
    writeFileSync(join(box.dataRoot, 'jds', '002-globex-designer.md'), 'Apply by 2026-10-18');
    // Right number, wrong company: not attributed to row 3.
    writeFileSync(join(box.dataRoot, 'jds', '003-otherco-writer.md'), 'Closes 2026-10-18');
    const r = run(['--today', '2026-10-17'], box);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.closingSoon.map(x => [x.num, x.closes, x.source]), [[1, '2026-10-21', 'capture']]);
    assert.equal(out.unparsed.length, 0);
  } finally {
    cleanup(box);
  }
});

test('tolerates a tracker with malformed and truncated rows', () => {
  const md = `${TRACKER}| 10 | 2026-10-01 | Half\n| not a row\n|||\n`;
  const r = computeClosingSoon(md, { today: TODAY, within: 7, statuses: evaluated });
  assert.equal(r.closingSoon.length, 4);
});

test('captures: marker words without a date are prose; unreadable date-shaped text still reports', () => {
  const lax = extractClosingDates('A deadline-driven team. Deadline: rolling.', TODAY, { strictMarkers: false });
  assert.deepEqual(lax, { dates: [], unparsed: [] });
  const dated = extractClosingDates('Deadline: 4 Nov 2026', TODAY, { strictMarkers: false });
  assert.equal(dated.unparsed.length, 1);
  const box = sandbox();
  try {
    writeFileSync(join(box.dataRoot, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | none |',
      '',
    ].join('\n'));
    writeFileSync(join(box.dataRoot, 'jds', '001-acme-analyst.md'), 'We are a deadline-driven team. Deadline: rolling.');
    const out = JSON.parse(run(['--today', '2026-10-17'], box).stdout);
    assert.deepEqual([out.closingSoon, out.overdue, out.unparsed], [[], [], []]);
  } finally {
    cleanup(box);
  }
});

test('alias status cells match the filter through the states.yml lookup', () => {
  const md = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | evaluada | ❌ | — | closes 2026-10-20 |',
    '',
  ].join('\n');
  const r = computeClosingSoon(md, { today: TODAY, within: 7, statuses: evaluated });
  assert.deepEqual(r.closingSoon.map(x => [x.num, x.status]), [[1, 'Evaluated']]);
});

test('captures: html markup between marker and date is stripped; script/style do not create markers', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dataRoot, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | none |',
      '| 2 | 2026-10-01 | Globex | Designer | 4.0/5 | Evaluated | ❌ | [2](reports/002-globex-2026-10-01.md) | none |',
      '',
    ].join('\n'));
    writeFileSync(join(box.dataRoot, 'jds', '001-acme-analyst.html'),
      '<p><strong>Closing date:</strong>&nbsp;<span>Oct 21, 2026</span></p>');
    writeFileSync(join(box.dataRoot, 'jds', '002-globex-designer.html'),
      '<style>.deadline 2026-10-18 {}</style><script>var deadline = "2026-10-19";</script><p>Hello</p>');
    const out = JSON.parse(run(['--today', '2026-10-17'], box).stdout);
    assert.deepEqual(out.closingSoon.map(x => [x.num, x.closes]), [[1, '2026-10-21']]);
    assert.deepEqual([out.overdue, out.unparsed], [[], []]);
  } finally {
    cleanup(box);
  }
});

test('captures: dates inside tag attributes (even containing ">") and comments are not matched', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dataRoot, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | none |',
      '',
    ].join('\n'));
    writeFileSync(join(box.dataRoot, 'jds', '001-acme-analyst.html'),
      '<a title="deadline 2026-10-21">Apply</a><a title="x > deadline 2026-10-20" href=\'y\'>Go</a><!-- closes 2026-10-19 --><p>Hi</p>');
    const out = JSON.parse(run(['--today', '2026-10-17'], box).stdout);
    assert.deepEqual([out.closingSoon, out.overdue, out.unparsed], [[], [], []]);
  } finally {
    cleanup(box);
  }
});

test('captures: pathological unterminated markup is still read around', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dataRoot, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Analyst | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | none |',
      '',
    ].join('\n'));
    const hostile = ['<a ', '<a "', '<script ', '<!-- '].map(u => u.repeat(10000)).join('\n');
    writeFileSync(join(box.dataRoot, 'jds', '001-acme-analyst.html'),
      `${hostile}\n<strong>Closing date:</strong><span>Oct 21, 2026</span>`);
    const out = JSON.parse(run(['--today', '2026-10-17'], box).stdout);
    assert.deepEqual(out.closingSoon.map(x => x.closes), ['2026-10-21']);
  } finally {
    cleanup(box);
  }
});

test('htmlToText: hostile unterminated markup stays near-linear (in-process, generous bound)', () => {
  // The old tag regex needed ~17s for 200k of this; a linear scan needs well
  // under a second. 5s leaves ample headroom for a loaded CI runner while still
  // failing on quadratic or exponential backtracking.
  for (const unit of ['<a ', '<a "', '<script ', '<!-- ']) {
    const input = unit.repeat(Math.ceil(200000 / unit.length));
    const t = process.hrtime.bigint();
    htmlToText(input);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 5000, JSON.stringify(unit) + ' took ' + Math.round(ms) + 'ms');
  }
});

test('htmlToText: script/style end only at a real closing tag', () => {
  const t = (html) => htmlToText(html).replace(/\s+/g, ' ').trim();
  assert.equal(t('<script>deadline 2026-10-18 </scripture> deadline 2026-10-19</script>after'), 'after');
  assert.equal(t('<style>x 2026-10-18 </styled> y</STYLE >after'), 'after');
  assert.equal(t('a<script src=x></script>b'), 'a b');
  // No real closer: the block is not silently swallowed to the end.
  assert.match(t('<script>never closed </scripture> closes 2026-10-20'), /2026-10-20/);
});
