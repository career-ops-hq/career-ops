// tests/normalize-statuses-dated-cells.test.mjs — normalize-statuses strips a
// trailing date from every status states.yml defines, not only two Spanish ones.
//
// verify-pipeline.mjs Check 1 flags `Status contains date: "Applied 2026-01-02"`
// and says to "run node normalize-statuses.mjs to strip the date from the
// status cell". That run reported the cell as an unknown status and left it,
// because normalizeStatus() stripped a date only in its `aplicado` and
// `rechazado` special cases. The remediation the health check prints was a
// dead end for every other dated cell, English labels included, while every
// reader (resolveCanonicalStateId(), followup-cadence) resolved the same cell
// fine.
//
// The census runs over every label and alias in templates/states.yml, so a
// state added later is covered without editing this file.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadCanonicalStates, resolveCanonicalStateId, stripStatusDecoration } from '../tracker-utils.mjs';
import { normalizeStatus } from '../normalize-statuses.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const STATES = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
const labelOf = (id) => STATES.find(s => s.id.toLowerCase() === id).label;

console.log('\nnormalize-statuses — a dated status cell normalizes to its state');

ok('every states.yml label and alias with a date appended normalizes to that state', () => {
  const spellings = STATES.flatMap(s => [s.label, ...s.aliases].map(spelling => ({ spelling, label: s.label })));
  // Guard on the guard: an empty or truncated vocabulary would pass vacuously.
  assert.ok(spellings.length >= 40, `expected the full states.yml vocabulary, got ${spellings.length} spellings`);
  const wrong = [];
  for (const { spelling, label } of spellings) {
    for (const cell of [`${spelling} 2026-01-02`, `**${spelling}** 2026-01-02`]) {
      const got = normalizeStatus(cell);
      if (got.status !== label || got.unknown) wrong.push(`${JSON.stringify(cell)} → ${JSON.stringify(got)}, want ${label}`);
    }
  }
  assert.deepStrictEqual(wrong, []);
});

ok('a date reads the same however it joins the state, for every spelling', () => {
  const joined = (s) => [`${s} (2026-01-02)`, `${s} - 2026-01-02`, `${s} – 2026-01-02`, `${s} — 2026-01-02`,
    `${s}, 2026-01-02`, `${s}: 2026-01-02`, `${s} / 2026-01-02`, `${s} on 2026-01-02`, `${s}-2026-01-02`,
    `2026-01-02 ${s}`, `2026-01-02: ${s}`, `**${s}** (2026-01-02)`];
  const wrong = [];
  for (const state of STATES) {
    for (const spelling of [state.label, ...state.aliases]) {
      for (const cell of joined(spelling)) {
        if (stripStatusDecoration(cell) !== spelling) wrong.push(`${cell} → ${stripStatusDecoration(cell)}`);
        if (normalizeStatus(cell).status !== state.label) wrong.push(`${cell} → ${JSON.stringify(normalizeStatus(cell))}`);
      }
    }
  }
  assert.deepStrictEqual(wrong, []);
});

ok('a date alone, or next to a word that is no state, still resolves to nothing', () => {
  assert.strictEqual(resolveCanonicalStateId('2026-01-02', STATES), null);
  assert.strictEqual(resolveCanonicalStateId('Pending (2026-01-02)', STATES), null);
  assert.deepStrictEqual(normalizeStatus('Pending - 2026-01-02'), { status: null, unknown: true });
});

ok('the result is the state the readers resolve the same cell to', () => {
  // The two must agree by construction: verify-pipeline, dedup-tracker and
  // the dashboards read a dated cell through resolveCanonicalStateId().
  for (const cell of ['Applied 2026-01-02', '**Interview** 2026-02-10', 'Rejected 2026-05-06', 'Mülakat 2026-02-02']) {
    assert.strictEqual(normalizeStatus(cell).status, labelOf(resolveCanonicalStateId(cell, STATES)), cell);
  }
});

ok('text after the date is kept in Notes, not dropped with the date', () => {
  assert.deepStrictEqual(normalizeStatus('Applied 2026-01-02 via referral'),
    { status: 'Applied', moveToNotes: 'Applied 2026-01-02 via referral' });
  assert.deepStrictEqual(normalizeStatus('Applied 2026-01-02'), { status: 'Applied' }, 'a bare date moves nothing');
});

ok('text after a date joined some other way is kept in Notes too', () => {
  for (const cell of ['Applied (2026-01-02) via referral', 'Applied - 2026-01-02 via referral', 'Applied on 2026-01-02 via referral']) {
    assert.deepStrictEqual(normalizeStatus(cell), { status: 'Applied', moveToNotes: cell });
  }
  assert.deepStrictEqual(normalizeStatus('Applied (2026-01-02)'), { status: 'Applied' }, 'the closing bracket is no text');
});

ok('the Spanish spellings keep what follows the date too', () => {
  assert.deepStrictEqual(normalizeStatus('Aplicado 2026-01-02 via referral'),
    { status: 'Applied', moveToNotes: 'Aplicado 2026-01-02 via referral' });
  assert.deepStrictEqual(normalizeStatus('Rechazado 2026-01-02 tras la entrevista'),
    { status: 'Rejected', moveToNotes: 'Rechazado 2026-01-02 tras la entrevista' });
  assert.deepStrictEqual(normalizeStatus('Aplicado 2026-01-02'), { status: 'Applied' });
  assert.deepStrictEqual(normalizeStatus('Aplicado 2026'), { status: 'Applied' }, 'a year alone still matches');
});

ok('a dated word that is no state is still reported as unknown', () => {
  assert.deepStrictEqual(normalizeStatus('Pending 2026-01-02'), { status: null, unknown: true });
});

ok('the CLI rewrites dated cells and reports no unknown statuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-dated-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-02 | Acme | Platform Engineer | 4.5/5 | Applied 2026-01-02 | ❌ | — |  |',
      '| 2 | 2026-01-03 | Globex | Data Engineer | 4.0/5 | **Interview** 2026-02-10 | ❌ | — | panel booked |',
      '| 3 | 2026-01-04 | Initech | Analyst | 3.5/5 | Applied 2026-01-04 via referral | ❌ | — |  |',
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(ROOT, 'normalize-statuses.mjs')], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.strictEqual(r.status, 0, `normalize-statuses exited ${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /unknown status/, r.stdout);
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l))
      .map(l => l.split('|').map(c => c.trim()));
    assert.deepStrictEqual(rows.map(c => c[6]), ['Applied', 'Interview', 'Applied']);
    assert.deepStrictEqual(rows.map(c => c[9]), ['', 'panel booked', 'Applied 2026-01-04 via referral']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

ok('without a Notes column, a cell with words after its date is left as it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-no-notes-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report |',
      '|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-02 | Acme | Platform Engineer | 4.5/5 | Applied 2026-01-02 via referral | ❌ | — |',
      '| 2 | 2026-01-03 | Globex | Data Engineer | 4.0/5 | Applied 2026-01-03 | ❌ | — |',
      '| 3 | 2026-01-04 | Initech | Analyst | 3.5/5 | Aplicado 2026-01-04 via referral | ❌ | — |',
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(ROOT, 'normalize-statuses.mjs')], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.strictEqual(r.status, 0, `normalize-statuses exited ${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /unknown status/, 'the state is known; only the words have nowhere to go');
    assert.match(r.stdout, /2 dated statuses left as they are: the tracker has no Notes column.*\n {2}#1 \(line 5\): "Applied 2026-01-02 via referral"\n {2}#3 /);
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l))
      .map(l => l.split('|').map(c => c.trim()));
    assert.deepStrictEqual(rows.map(c => c[6]), ['Applied 2026-01-02 via referral', 'Applied', 'Aplicado 2026-01-04 via referral'],
      'a bare date still goes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// verify-pipeline tells the user to run this script for a dated cell, so the
// two have to agree on every cell, not only on the shape one of them expected.
ok('every cell verify-pipeline flags as dated comes out clean after normalizing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-verify-test-'));
  const cells = ['Applied 2026-01-02', 'Applied (2026-01-02)', 'Applied - 2026-01-02', 'Applied, 2026-01-02', 'Applied: 2026-01-02',
    'Applied on 2026-01-02', '2026-01-02 Applied', '**Interview** (2026-02-10)', 'Rejected - 2026-05-06 by mail'];
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PIPELINE: '',
    CAREER_OPS_SCAN_HISTORY: '', CAREER_OPS_PORTALS: '', CAREER_OPS_PROFILE: '', CAREER_OPS_FOLLOWUPS: '', CAREER_OPS_REPORTS: '',
    CAREER_OPS_CV: '', CAREER_OPS_JDS: '', CAREER_OPS_ADDITIONS: '', CAREER_OPS_ACTIVITY_DIR: '' };
  const run = (script) => spawnSync(process.execPath, [join(ROOT, script)], { encoding: 'utf-8', env, cwd: dir });
  const dated = (out) => (out.match(/Status contains date/g) ?? []).length;
  try {
    mkdirSync(join(dir, 'data'));
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      ...cells.map((cell, i) => `| ${i + 1} | 2026-01-02 | Co${i} | Role${i} | 4.0/5 | ${cell} | ❌ | — |  |`),
      ''].join('\n'));
    const before = run('verify-pipeline.mjs');
    assert.strictEqual(dated(before.stdout), cells.length, `the premise: ${before.stdout}`);
    assert.doesNotMatch(before.stdout, /Non-canonical status/, 'a known state under a date is not an unknown status');
    assert.strictEqual(run('normalize-statuses.mjs').status, 0);
    const after = run('verify-pipeline.mjs');
    assert.strictEqual(dated(after.stdout), 0, after.stdout);
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(c => c.trim()));
    assert.deepStrictEqual(rows.map(c => c[6]), [...Array(6).fill('Applied'), 'Applied', 'Interview', 'Rejected']);
    assert.strictEqual(rows[8][9], 'Rejected - 2026-05-06 by mail', 'the words after the date move to Notes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// set-status.mjs reads Notes as "; "-separated entries. Joined with ". ", the
// moved text and the note beside it read as one entry, so --replace-note could
// not find the note and --note added it a second time.
ok('moved text is its own Notes entry, and a "—" placeholder gives way to it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-notes-test-'));
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_ACTIVITY_DIR: '' };
  const run = (script, ...args) => spawnSync(process.execPath, [join(ROOT, script), ...args], { encoding: 'utf-8', env, cwd: dir });
  try {
    mkdirSync(join(dir, 'data'));
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-04 | Initech | Analyst | 3.5/5 | Applied 2026-01-04 via referral | ❌ | — | call booked |',
      '| 2 | 2026-01-04 | Globex | Analyst | 3.5/5 | Applied 2026-01-04 via referral | ❌ | — | — |',
      '| 3 | 2026-01-04 | Hooli | Analyst | 3.5/5 | Applied 2026-01-04 via referral | ❌ | — | Reviewed Applied 2026-01-04 via referral |',
      '| 4 | 2026-01-04 | Umbrella | Analyst | 3.5/5 | Applied 2026-01-04 via referral | ❌ | — | x; Applied 2026-01-04 via referral |',
      ''].join('\n'));
    const notes = () => readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|')[9].trim());
    assert.strictEqual(run('normalize-statuses.mjs').status, 0);
    assert.deepStrictEqual(notes(), ['Applied 2026-01-04 via referral; call booked', 'Applied 2026-01-04 via referral',
      // Inside a longer note it is no entry of its own, so it is still moved.
      'Applied 2026-01-04 via referral; Reviewed Applied 2026-01-04 via referral',
      'x; Applied 2026-01-04 via referral']);
    const replaced = run('set-status.mjs', '1', 'Applied', '--note', 'call done', '--replace-note', 'call booked');
    assert.strictEqual(replaced.status, 0, replaced.stderr || replaced.stdout);
    assert.strictEqual(notes()[0], 'Applied 2026-01-04 via referral; call done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
