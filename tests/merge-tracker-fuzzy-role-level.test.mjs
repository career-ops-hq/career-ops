// tests/merge-tracker-fuzzy-role-level.test.mjs — a one-sided level plus a
// two-sided vocabulary difference must not dedupe (#4058).
//
// Drives the REAL merge-tracker.mjs CLI end-to-end against a temp tracker via
// the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS env hooks. Both rows carry no
// posting URL (empty column, report files absent so resolveReportUrl yields
// no-report), different report numbers (tier 1 stays out), and different
// entry numbers (tier 2 stays out) — so tier 3, company + fuzzy role, is what
// decides. Asserting on the resulting tracker rows proves the fix where the
// bug lived. A same-role control proves the harness still merges true reposts.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MERGE = join(HERE, '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

const ROLE_A = 'Front Desk Assistant (Summer Housing)';
const ROLE_B = 'Administrative Assistant II (Housing Front Desk)';

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'merge-role-level-test-'));
  const dataDir = join(base, 'data');
  const addDir = join(base, 'additions');
  const reportsDir = join(base, 'reports');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(addDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  return { base, tracker: join(dataDir, 'applications.md'), addDir };
}
function writeTracker(env, rows) {
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
}
function trackerRows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n')
    .filter(l => l.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(l) && !/^\|\s*#\s*\|/.test(l));
}
function runMerge(env) {
  return execFileSync('node', [MERGE], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir },
  });
}
const cleanup = (env) => rmSync(env.base, { recursive: true, force: true });

console.log('\nmerge-tracker — one-sided level + two-sided vocabulary (#4058)');

ok('THE BUG: two distinct same-company roles stay two rows', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      `| 1 | 2026-09-01 | Acme Health | ${ROLE_A} | 4.0/5 | Evaluated | ❌ | [1](reports/1-acme.md) | n | |`,
    ]);
    writeFileSync(join(env.addDir, '2-acme.tsv'),
      ['2', '2026-09-09', 'Acme Health', ROLE_B, 'Evaluated', '4.1/5', '❌', '[2](reports/2-acme.md)', 'n', ''].join('\t'));
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `expected 2 rows, got ${rows.length}`);
  } finally { cleanup(env); }
});

ok('control: a true same-role repost still merges to one row', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      `| 1 | 2026-09-01 | Acme Health | ${ROLE_A} | 4.0/5 | Evaluated | ❌ | [1](reports/1-acme.md) | n | |`,
    ]);
    writeFileSync(join(env.addDir, '2-acme.tsv'),
      ['2', '2026-09-09', 'Acme Health', ROLE_A, 'Evaluated', '4.1/5', '❌', '[2](reports/2-acme.md)', 'n', ''].join('\t'));
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, `expected 1 row, got ${rows.length}`);
  } finally { cleanup(env); }
});
