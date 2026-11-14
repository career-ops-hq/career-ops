// tests/merge-tracker-rejects-headerless.test.mjs — merge-tracker.mjs refuses
// headerless tracker-addition TSVs unless --allow-headerless is passed
// (audit candidate C-007, F-002).
//
// The undecidable case: `—` is both a score sentinel (#1799) and the Discarded
// status (normalize-statuses.mjs), so a headerless discarded, never-scored row
// carries `—` in both cells and no content rule can order them
// (#1427 / #1799). The headed form (#3517) has no such case — columns resolve
// by NAME via tracker-parse.mjs's resolveTsvColumns. A discarded row can only
// be merged safely with labels; therefore merge-tracker refuses headerless
// additions unless the caller opts in with --allow-headerless.
//
// Run:  node --test tests/merge-tracker-rejects-headerless.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE, ROOT, rmSync as rmSyncWin, isolatedBatchStatePath, ownRootEnv } from './helpers.mjs';

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const D = '2026-09-04';
// Headerless batch-TSV order per AGENTS.md: num date company role status score pdf report notes
const headerless = (n) =>
  `${n}\t${D}\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t[${n}](reports/${n}-acme-${D}.md)\tnote\n`;
const headedCells = (n) =>
  `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n${n}\t${D}\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t[${n}](reports/${n}-acme-${D}.md)\tnote\n`;
// The pipe path is score-before-status, matching applications.md (see
// parseTsvContent). It is the same positional form and hits the same guard.
const headerlessPipe = (n) =>
  `| ${n} | ${D} | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [${n}](reports/${n}-acme-${D}.md) | note |\n`;

const rowOf = (text) =>
  text.split('\n').find((l) => /^\|\s*\d/.test(l));

/** Spawn merge-tracker on one addition file; return {row, code, out}. */
function mergeOne(content, extraArgs = []) {
  const work = mkdtempSync(join(tmpdir(), 'cops-headerless-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, TRACKER);
    writeFileSync(join(adds, 'a.tsv'), content);
    const res = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs'), ...extraArgs], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ownRootEnv({
        // Pin the child's data root at the fixture and blank the inherited
        // overrides. ownRootEnv() clears CAREER_OPS_DATA_DIR and
        // CAREER_OPS_PDF_SHARED but not CAREER_OPS_PDF_INDEX, and
        // resolvePdfIndexPath() prefers that variable, so it has to be cleared
        // here too or a developer's exported manifest would be read and written
        // during the run.
        CAREER_OPS_ROOT: work,
        CAREER_OPS_TRACKER: tracker,
        CAREER_OPS_ADDITIONS: adds,
        CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(adds),
        CAREER_OPS_PDF_INDEX: '',
        CAREER_OPS_FOLLOWUPS: '',
        CAREER_OPS_FOLLOWUPS_LOCK: '',
      }),
    });
    return {
      row: rowOf(readFileSync(tracker, 'utf-8')) ?? null,
      code: res.status ?? -1,
      out: String(res.stdout ?? '') + String(res.stderr ?? ''),
      // A refused addition is SKIPPED, not consumed: it must still be on disk so
      // the re-run the warning asks for finds it (#5862). Captured before the
      // fixture cleanup, since the directory goes away in the finally block.
      additionKept: existsSync(join(adds, 'a.tsv')),
    };
  } finally {
    try { rmSyncWin(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

test('default (no flag): headerless TSV is refused, warning names --allow-headerless', () => {
  const { row, out, code, additionKept } = mergeOne(headerless(42));
  assert.equal(row, null, `expected refusal, but row "${row?.trim()}" was merged`);
  assert.equal(code, 0, `a refused addition is a skip, not a failed run: ${out.trim().split('\n').pop()}`);
  assert.equal(additionKept, true, 'the refused addition must stay on disk so the re-run it asks for finds it');
  assert.match(
    out,
    /headerless/i,
    `expected a headerless warning, got: ${out.trim().split('\n').pop()}`,
  );
  assert.match(out, /--allow-headerless/i, `expected the opt-in flag named: ${out.trim().split('\n').pop()}`);
  // The label list names the optional columns too: a legacy row that carries
  // via/location/url and is re-headed with the nine core labels only would leave
  // the extra cell unlabelled, and parseHeadedAddition reads by label, so the
  // value would be dropped. The warning has to say so.
  const warningLine = out.split('\n').find((l) => /headerless tracker-addition refused/.test(l)) ?? '';
  for (const label of ['via', 'location', 'url']) {
    assert.ok(
      new RegExp(`\\b${label}\\b`).test(warningLine),
      `the refusal must name the optional "${label}" column: ${warningLine}`,
    );
  }
});

test('default (no flag): a markdown pipe row falls under the same guard', () => {
  const { row, out, code, additionKept } = mergeOne(headerlessPipe(42));
  assert.equal(row, null, `expected refusal, but row "${row?.trim()}" was merged`);
  assert.equal(code, 0, `a refused addition is a skip, not a failed run: ${out.trim().split('\n').pop()}`);
  assert.equal(additionKept, true, 'the refused addition must stay on disk so the re-run it asks for finds it');
  assert.match(out, /--allow-headerless/i, `expected the opt-in flag named: ${out.trim().split('\n').pop()}`);
});

test('--allow-headerless: headerless TSV still merges (legacy behavior preserved)', () => {
  const { row, out } = mergeOne(headerless(42), ['--allow-headerless']);
  assert.equal(row?.includes('| 42 |'), true, `expected num 42 merged, got row "${row?.trim()}" output: ${out.trim().split('\n').pop()}`);
  assert.match(out, /merged|merge/i, `expected a merge confirmation: ${out.trim().split('\n').pop()}`);
});

test('--allow-headerless: markdown pipe row still merges', () => {
  const { row, out } = mergeOne(headerlessPipe(42), ['--allow-headerless']);
  assert.equal(row?.includes('| 42 |'), true, `expected num 42 merged, got row "${row?.trim()}" output: ${out.trim().split('\n').pop()}`);
});

test('control: headed TSV merges without any flag', () => {
  const { row, out } = mergeOne(headedCells(42));
  assert.equal(row?.includes('| 42 |'), true, `expected headed num 42 merged, got row "${row?.trim()}" output: ${out.trim().split('\n').pop()}`);
});
