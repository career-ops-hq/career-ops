// tests/merge-tracker-keeps-refused-additions.test.mjs — a TSV merge-tracker
// refuses stays in the additions dir, where the re-run its warning asks for
// will find it.
//
// merge-tracker archives processed TSVs into merged/ "but only the ones
// actually applied", because an archived TSV whose row never reached the
// tracker is out of the re-run's sight. Only the (unreachable) failed-update
// path was excluded, though. A TSV the parser refused (a header that labels
// `score` twice, a blank required cell, a column swap) or the batch-state
// guard refused was moved into merged/ with the rest, right after a warning
// that asks the user to fix the file and re-run.
//
// Only the archiving changes: a refusal still counts as skipped and the run
// still exits 0 (tracker-columns.test.mjs and the column-order checks in
// test-all.mjs pin both). The deliberate skip, an unscoreable re-eval that
// keeps the existing score, is still archived: there is nothing in it to
// retry.
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const TRACKER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');
const HEADER = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';
const tsv = (...cells) => `${HEADER}\n${cells.join('\t')}\n`;
const GOOD = tsv('1', '2026-10-01', 'Acme', 'Platform Engineer', 'Evaluated', '4.2/5', '❌', '[1](reports/001-acme-2026-10-01.md)', 'ok');
// `score` labelled twice: parseHeadedAddition refuses to guess which carries the value.
const TWO_SCORES = `num\tdate\tcompany\trole\tscore\tscore\tpdf\treport\tnotes\n`
  + '2\t2026-10-02\tGlobex\tData Engineer\tEvaluated\t4.0/5\t❌\t[2](reports/002-globex-2026-10-02.md)\tfirst evaluation\n';
const FIXED = tsv('2', '2026-10-02', 'Globex', 'Data Engineer', 'Evaluated', '4.0/5', '❌', '[2](reports/002-globex-2026-10-02.md)', 'first evaluation');

/** One workspace that survives between runs, so a replay sees what the first run left. */
function workspace(rows = '') {
  const work = mkdtempSync(join(tmpdir(), 'cops-keep-refused-'));
  const adds = join(work, 'adds');
  mkdirSync(adds, { recursive: true });
  writeFileSync(join(work, 'applications.md'), TRACKER.replace(/\n$/, `\n${rows}`));
  return {
    work,
    adds,
    write: (name, text) => writeFileSync(join(adds, name), text),
    run(stateRows = null) {
      const state = join(work, 'batch-state.tsv');
      if (stateRows) {
        writeFileSync(state, ['id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries', ...stateRows, ''].join('\n'));
      }
      const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8', timeout: 30000,
        env: { ...process.env, CAREER_OPS_TRACKER: join(work, 'applications.md'), CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: state },
      });
      const merged = join(adds, 'merged');
      return {
        status: r.status,
        out: `${r.stdout}${r.stderr}`,
        pending: readdirSync(adds).filter(f => f.endsWith('.tsv')).sort(),
        archived: existsSync(merged) ? readdirSync(merged).sort() : [],
        rows: readFileSync(join(work, 'applications.md'), 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)),
      };
    },
    close: () => rmSync(work, { recursive: true, force: true }),
  };
}

console.log('\nmerge-tracker — a refused addition is kept for the re-run, not archived');

ok('a TSV the parser refuses stays pending while the good one merges and is archived', () => {
  const ws = workspace();
  try {
    ws.write('001-acme.tsv', GOOD);
    ws.write('002-globex.tsv', TWO_SCORES);
    const r = ws.run();
    assert.match(r.out, /Skipping 002-globex\.tsv: header labels the same column twice/, 'premise: the parser refuses it');
    assert.deepStrictEqual(r.archived, ['001-acme.tsv'], 'only the applied TSV is archived');
    assert.deepStrictEqual(r.pending, ['002-globex.tsv'], 'the refused TSV must stay where the re-run looks');
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.status, 0, 'a refusal is still a skip, not a failed run');
    assert.match(r.out, /⏭️1 skipped/);
    assert.match(r.out, /1 skipped addition\(s\) left in .* for a re-run: 002-globex\.tsv/, 'the user is told the file is still there');
  } finally { ws.close(); }
});

ok('fixing the kept TSV in place and re-running merges it', () => {
  // What the warning tells the user to do, done literally in the same workspace.
  const ws = workspace();
  try {
    ws.write('002-globex.tsv', TWO_SCORES);
    assert.deepStrictEqual(ws.run().pending, ['002-globex.tsv']);
    ws.write('002-globex.tsv', FIXED);
    const r = ws.run();
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(r.pending, []);
    assert.deepStrictEqual(r.archived, ['002-globex.tsv']);
    assert.strictEqual(r.rows.length, 1);
  } finally { ws.close(); }
});

ok('a TSV the batch-state guard refuses is kept too', () => {
  // Its own warning offers "set report_num to - on the failed row and re-run".
  const ws = workspace();
  try {
    ws.write('001-acme.tsv', GOOD);
    const r = ws.run(['36\thttps://example.com/job/a\tfailed\t-\t-\t1\t-\t-\t0']);
    assert.match(r.out, /is marked "failed" in batch-state\.tsv/, 'premise: the guard refuses it');
    assert.deepStrictEqual(r.pending, ['001-acme.tsv']);
    assert.deepStrictEqual(r.archived, []);
    assert.strictEqual(r.status, 0);
  } finally { ws.close(); }
});

ok('an empty TSV is named and kept, not archived in silence', () => {
  const ws = workspace();
  try {
    ws.write('003-empty.tsv', '');
    const r = ws.run();
    assert.match(r.out, /Skipping 003-empty\.tsv: the file is empty/);
    assert.deepStrictEqual(r.pending, ['003-empty.tsv']);
    assert.strictEqual(r.status, 0);
  } finally { ws.close(); }
});

ok('the deliberate unscoreable re-eval skip is still archived, exit 0', () => {
  // Scope check: nothing in this TSV is left to retry; the row keeps its score.
  const ws = workspace('| 1 | 2026-10-01 | Acme | Platform Engineer | 4.2/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-10-01.md) | ok |\n');
  try {
    ws.write('009-acme.tsv', tsv('1', '2026-10-09', 'Acme', 'Platform Engineer', 'Evaluated', 'N/A', '❌', '[1](reports/001-acme-2026-10-01.md)', 'fetch failed'));
    const r = ws.run();
    assert.match(r.out, /⏭️1 skipped/, 'premise: this is the deliberate skip');
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(r.pending, []);
    assert.deepStrictEqual(r.archived, ['009-acme.tsv']);
    assert.doesNotMatch(r.out, /left in .* for a re-run/);
  } finally { ws.close(); }
});
