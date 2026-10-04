// tests/merge-tracker-report-file-dedup.test.mjs — Pass 0.5: same report FILE
// on disk is unambiguous proof of identity, even when company/role fuzzy
// matching (tier 1's #912 guard) would refuse the match on its own.
//
// Drives the REAL merge-tracker.mjs CLI end-to-end (same harness as
// tests/merge-tracker-url-dedup.test.mjs) — the merge path is where the bug
// lived, so asserting on the resulting tracker rows is what actually proves
// the fix.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MERGE = join(HERE, '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'merge-report-file-test-'));
  const dataDir = join(base, 'data');
  const addDir = join(base, 'additions');
  const reportsDir = join(base, 'reports');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(addDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const tracker = join(dataDir, 'applications.md');
  return { base, dataDir, addDir, reportsDir, tracker };
}
function writeTracker(env, rows) {
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
}
function addTsv(env, name, cols) {
  writeFileSync(join(env.addDir, name), cols.join('\t'));
}
function runMerge(env, args = []) {
  return execFileSync('node', [MERGE, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir) },
  });
}
function trackerRows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n').filter(l => l.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(l) && !/^\|\s*#\s*\|/.test(l));
}
const cleanup = (env) => rmSync(env.base, { recursive: true, force: true });

console.log('\nmerge-tracker — report-file dedup (#4506)');

ok('THE BUG: two concurrent additions for the SAME report, spelled differently, collapse to one row', () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env.reportsDir, '2110-revera.md'), '# Eval\n**Score:** 3.5/5\n**URL:** N/A\n');
    writeTracker(env, [
      '| 2110 | 2026-09-20 | Revera | Recreation Therapist | 3.5/5 | Evaluated | ❌ | [2110](reports/2110-revera.md) | n |',
    ]);
    // Concurrent session's addition: same report, but a division-qualified
    // company spelling different enough that fuzzy company matching (and
    // tier 1's #912 company guard) would refuse to treat this as the same row.
    addTsv(env, '2110-revera.tsv', ['2110', '2026-09-20', 'Revera (Cogir Senior Living)', 'Recreation Therapist', 'Evaluated', '3.5/5', '❌', '[2110](reports/2110-revera.md)', 'concurrent-session re-eval']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, `expected the same-report addition to update the existing row, got ${rows.length} rows (duplicate)`);
    assert.ok(rows[0].includes('concurrent-session re-eval'), 'the incoming note was actually merged in, not just deduped away');
  } finally { cleanup(env); }
});

ok('control: two DIFFERENT reports for a similarly-spelled company stay two rows', () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env.reportsDir, '10-acme.md'), '# Eval\n**Score:** 4.0/5\n**URL:** N/A\n');
    writeFileSync(join(env.reportsDir, '11-acme.md'), '# Eval\n**Score:** 4.1/5\n**URL:** N/A\n');
    writeTracker(env, [
      '| 10 | 2026-09-01 | Acme | Strategy Manager | 4.0/5 | Evaluated | ❌ | [10](reports/10-acme.md) | n |',
    ]);
    addTsv(env, '11-acme.tsv', ['11', '2026-09-02', 'Acme (Growth Division)', 'Strategy Manager, Growth', 'Evaluated', '4.1/5', '❌', '[11](reports/11-acme.md)', 'genuinely a different posting']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, 'different report files must never be collapsed, even with a similar company spelling');
  } finally { cleanup(env); }
});

ok('a conflicting explicit URL still blocks the report-file match (URL disagreement wins)', () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env.reportsDir, '30-acme.md'), '# Eval\n**Score:** 4.0/5\n**URL:** N/A\n');
    const H = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
    const S = '|---|---|---|---|---|---|---|---|---|---|';
    writeFileSync(env.tracker, ['# T', '', H, S,
      `| 30 | 2026-09-01 | Acme | Strategy Manager | 4.0/5 | Evaluated | ❌ | [30](reports/30-acme.md) | n | https://acme.com/jobs/111 |`, ''].join('\n'));
    // Same report link, but the addition explicitly carries a DIFFERENT URL —
    // a genuine conflict signal that must not be overridden by the file match.
    addTsv(env, '30-acme.tsv', ['30', '2026-09-02', 'Acme Corp', 'Strategy Manager', 'Evaluated', '4.2/5', '❌', '[30](reports/30-acme.md)', 'note', 'https://acme.com/jobs/999']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, 'a conflicting explicit URL must still be respected as evidence of a distinct posting');
  } finally { cleanup(env); }
});
