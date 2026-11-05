// tests/merge-tracker-open-header.test.mjs — a tracker whose header row has no
// closing pipe keeps its last column through a merge.
//
// merge-tracker sizes every row it builds from the header's width
// (HEADER_WIDTH), counted as `line.split('|').length`. For a header written
// `| # | … | Notes` (no closing pipe, still a valid Markdown table header,
// and a shape parseTrackerRow already reads for rows) that count is one
// short. buildRow then allocated one cell too few, and put('notes') failed
// without a word: a new row was written with no Notes, and an updated row
// lost the Notes it had. Exit 0, TSVs archived. The notes carry the
// `Applied YYYY-MM-DD` marker followup-cadence prefers, the req ids the
// sibling-req guard reads back, and set-status --note text. The tracker is
// gitignored and no backup is written.
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const TSV_HEADER = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';

/** Merge `additions` into a tracker whose header is `header`; return the data rows' cells. */
function merge(header, rows, additions) {
  const work = mkdtempSync(join(tmpdir(), 'cops-open-header-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, ['# Applications Tracker', '', header, '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
    for (const [name, line] of Object.entries(additions)) writeFileSync(join(adds, name), `${TSV_HEADER}\n${line}\n`);
    const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: join(work, 'no-batch-state.tsv') },
    });
    assert.strictEqual(r.status, 0, `merge-tracker exited ${r.status}: ${r.stdout}${r.stderr}`);
    return readFileSync(tracker, 'utf-8').split('\n')
      .filter(l => /^\|\s*\d+\s*\|/.test(l))
      .map(l => { const c = l.split('|').map(x => x.trim()); return { num: c[1], status: c[6], notes: c[9] ?? '' }; });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const OPEN = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes';
const CLOSED = `${OPEN} |`;
const EXISTING = '| 1 | 2026-01-01 | Initech | Analyst | 3.0/5 | Applied | ❌ | — | keep this note |';
const NEW_ROW = '5\t2026-02-01\tGlobex\tAnalyst\tEvaluated\t3.5/5\t❌\t—\treq JR-9981; Applied 2026-02-05';
const RE_EVAL = '1\t2026-03-01\tInitech\tAnalyst\tEvaluated\t3.4/5\t❌\t—\tre-eval';

console.log('\nmerge-tracker — a header without a closing pipe keeps its last column');

for (const [label, header] of [['open', OPEN], ['closed (control)', CLOSED]]) {
  ok(`${label} header: a new row is written with its notes`, () => {
    const rows = merge(header, [], { '005-globex.tsv': NEW_ROW });
    assert.deepStrictEqual(rows.map(r => r.notes), ['req JR-9981; Applied 2026-02-05']);
  });

  ok(`${label} header: an updated row keeps the notes it had`, () => {
    const rows = merge(header, [EXISTING], { '001-initech.tsv': RE_EVAL });
    assert.strictEqual(rows.length, 1, 'premise: the re-eval updates row #1');
    assert.match(rows[0].notes, /keep this note/, `row #1 notes after the update: ${JSON.stringify(rows[0].notes)}`);
  });
}
