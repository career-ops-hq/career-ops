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
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadCanonicalStates, resolveCanonicalStateId } from '../tracker-utils.mjs';
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
