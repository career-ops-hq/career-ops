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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// Pass 0.5 compares resolved paths. Only the addition's own path has to be a
// real file; an existing row whose path string equals it names the same file
// by definition. Statting every existing row's report for each addition, under
// the tracker lock, made the tier's cost grow with the tracker for no gain.
ok('the report-file tier does not stat every existing row\'s report', () => {
  const env = makeEnv();
  try {
    const N = 300;
    const rows = [];
    for (let i = 1; i <= N; i++) {
      writeFileSync(join(env.reportsDir, `${i}-co${i}.md`), `# Eval\n**Score:** 4.0/5\n**URL:** N/A\n`);
      rows.push(`| ${i} | 2026-09-01 | Co${i} | Role ${i} | 4.0/5 | Evaluated | ❌ | [${i}](reports/${i}-co${i}.md) | n |`);
    }
    writeTracker(env, rows);
    writeFileSync(join(env.reportsDir, `${N + 1}-newco.md`), '# Eval\n**Score:** 4.1/5\n**URL:** N/A\n');
    addTsv(env, `${N + 1}-newco.tsv`, [String(N + 1), '2026-09-02', 'Newco', 'Platform Engineer', 'Evaluated', '4.1/5', '❌', `[${N + 1}](reports/${N + 1}-newco.md)`, 'new']);

    // Count fs probes of reports/ in the child. syncBuiltinESMExports() makes
    // merge-tracker's named `statSync`/`existsSync` imports see the wrappers.
    const counter = join(env.base, 'count-stats.mjs');
    const countFile = join(env.base, 'stat-count.txt');
    writeFileSync(counter, [
      "import fs from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      // Values come from the environment, never spliced into this source.
      'const dirs = JSON.parse(process.env.COUNT_STAT_DIRS);',
      'let n = 0;',
      'for (const name of ["statSync", "existsSync"]) {',
      '  const orig = fs[name];',
      '  fs[name] = function (p, ...rest) { if (dirs.some((d) => String(p).startsWith(d))) n++; return orig.call(this, p, ...rest); };',
      '}',
      'syncBuiltinESMExports();',
      "process.on('exit', () => fs.writeFileSync(process.env.COUNT_STAT_FILE, String(n)));",
    ].join('\n'));
    execFileSync('node', ['--import', pathToFileURL(counter).href, MERGE], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
        // Both spellings: macOS reports a tmpdir path as /var or /private/var.
        COUNT_STAT_DIRS: JSON.stringify([env.reportsDir, realpathSync(env.reportsDir)]),
        COUNT_STAT_FILE: countFile,
      },
    });
    assert.equal(trackerRows(env).length, N + 1, 'the new posting is appended as its own row');
    const probes = Number(readFileSync(countFile, 'utf-8'));
    assert.ok(probes < 20, `merging one addition probed reports/ ${probes} times against a ${N}-row tracker`);
  } finally { cleanup(env); }
});
