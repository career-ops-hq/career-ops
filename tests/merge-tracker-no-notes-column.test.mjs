// tests/merge-tracker-no-notes-column.test.mjs — a tracker whose header has no
// Notes column. A merge still writes the row, so the note has nowhere to go, and
// it has to say so. A row can also run wider than that header: a merge that could
// not read the header's labels fell back to the legacy layout and stored notes in
// a ninth cell. A rebuild must not delete those cells.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MERGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const NO_NOTES = '| # | Date | Company | Role | Score | Status | PDF | Report |';
const WITH_NOTES = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';
const ROW = '| 10 | 2026-10-01 | Acme | Solutions Engineer | 3.5/5 | Applied | ❌ | [10](../reports/010-acme-2026-10-01.md) |';

function fixture(header, row) {
  const base = mkdtempSync(join(tmpdir(), 'merge-no-notes-'));
  const env = { base, tracker: join(base, 'data', 'applications.md'), addDir: join(base, 'additions'), reportsDir: join(base, 'reports') };
  for (const dir of [dirname(env.tracker), env.addDir, env.reportsDir]) mkdirSync(dir, { recursive: true });
  const width = header.split('|').length - 2;
  const table = ['# Applications Tracker', '', header, `|${'---|'.repeat(width)}`, ...(row ? [row] : []), ''];
  writeFileSync(env.tracker, table.join('\n'));
  writeFileSync(join(env.reportsDir, '010-acme-2026-10-01.md'), '# Evaluation: Acme\n\n**Score:** 3.5/5\n');
  return env;
}
function merge(env, { score = '4.4/5', notes = 'referred by a former colleague' } = {}) {
  const file = '011-acme-2026-10-02.md';
  writeFileSync(join(env.reportsDir, file), `# Evaluation: Acme\n\n**Score:** ${score}\n`);
  writeFileSync(join(env.addDir, '11.tsv'), `${TSV_HEAD}\n11\t2026-10-02\tAcme\tSolutions Engineer\tEvaluated\t${score}\t❌\t[11](reports/${file})\t${notes}\n`);
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_TRACKER: env.tracker,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
    CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_REPORTS_DIR: '',
    CAREER_OPS_PDF_INDEX: '',
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  const run = spawnSync('node', [MERGE], { encoding: 'utf-8', env: childEnv });
  assert.equal(run.status, 0, describeSpawn(run));
  return `${run.stdout}${run.stderr}`;
}
const rows = (env) => readFileSync(env.tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
const withFixture = (header, row, fn) => {
  const env = fixture(header, row);
  try { fn(env); } finally { rmSync(env.base, { recursive: true, force: true }); }
};

ok('a new row is written, and the note it could not hold is named and counted', () => {
  withFixture(NO_NOTES, null, (env) => {
    const output = merge(env);
    assert.strictEqual(rows(env).length, 1);
    assert.match(output, /Acme — Solutions Engineer: this tracker has no Notes column, so its note was not written: referred by a former colleague/);
    assert.match(output, /1 note\(s\) not written/);
  });
});

ok('a re-evaluation updates the row and names the note, marker included', () => {
  withFixture(NO_NOTES, ROW, (env) => {
    const output = merge(env);
    const [row, ...others] = rows(env);
    assert.deepStrictEqual(others, []);
    assert.match(row, /\| 4\.4\/5 \| Applied \|/);
    assert.match(output, /no Notes column, so its note was not written: Re-eval 2026-10-02 \(3\.5→4\.4\): referred/);
  });
});

ok('a re-evaluation keeps a cell past the header', () => {
  withFixture(NO_NOTES, `${ROW} an earlier note |`, (env) => {
    merge(env);
    assert.match(rows(env)[0], /\| 4\.4\/5 \| Applied \| ❌ \| \[11\]\(\.\.\/reports\/011-acme-2026-10-02\.md\) \| an earlier note \|$/);
  });
});

ok('a cell past the header survives on a row with no closing pipe', () => {
  withFixture(NO_NOTES, `${ROW} an earlier note`, (env) => {
    merge(env);
    assert.match(rows(env)[0], /\| an earlier note \|$/);
  });
});

ok('several cells past the header all survive, in order', () => {
  withFixture(NO_NOTES, `${ROW} first | second |`, (env) => {
    merge(env);
    assert.match(rows(env)[0], /\| first \| second \|$/);
  });
});

ok('a row no wider than its header gains no cell', () => {
  withFixture(NO_NOTES, ROW, (env) => {
    merge(env);
    assert.strictEqual(rows(env)[0].split('|').length, NO_NOTES.split('|').length);
  });
});

ok('an empty note is nothing to report', () => {
  withFixture(NO_NOTES, null, (env) => {
    assert.doesNotMatch(merge(env, { notes: '' }), /not written/);
  });
});

// A re-evaluation with no score leaves the row alone, so nothing was left out.
ok('an addition that changes nothing says nothing about its note', () => {
  withFixture(NO_NOTES, ROW, (env) => {
    const output = merge(env, { score: 'N/A' });
    assert.match(rows(env)[0], /\| 3\.5\/5 \|/);
    assert.doesNotMatch(output, /not written/);
  });
});

ok('a French tracker keeps the notes earlier merges stored past its header', () => {
  withFixture('| # | Date | Entreprise | Role | Score | Statut | PDF | Report |', `${ROW} an earlier note |`, (env) => {
    const output = merge(env);
    assert.match(rows(env)[0], /\| 4\.4\/5 \| Applied \| .* \| an earlier note \|$/);
    assert.match(output, /1 note\(s\) not written/);
  });
});

// The control: with a Notes column this is the ordinary path, and nothing changes.
ok('a tracker with a Notes column writes the note and warns about nothing', () => {
  withFixture(WITH_NOTES, null, (env) => {
    const output = merge(env);
    assert.match(rows(env)[0], /\| referred by a former colleague \|$/);
    assert.doesNotMatch(output, /not written/);
  });
});
