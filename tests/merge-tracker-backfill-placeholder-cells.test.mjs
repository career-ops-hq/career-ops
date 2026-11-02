// tests/merge-tracker-backfill-placeholder-cells.test.mjs — `--backfill-urls`
// fills a URL cell that only says "no URL", and leaves what it cannot fill as
// the user wrote it.
//
// The backfill counted any non-empty URL cell as already set. A hand-added row
// carries the tracker's `—` empty-cell marker there, and a recruiter-sourced
// role an `N/A`. Both name no posting (normalizeUrl reads them as "no key"),
// so such a row was reported as "already set" and never filled, even when its
// report's **URL:** header named the posting. A cell that holds something else
// (a real URL, a local:jds/ pointer) is the user's and must stay. An
// unfillable placeholder must stay too: erasing an `N/A` says less than the row
// did.
//
// Driven through the CLI with the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS
// overrides, like merge-tracker-backfill-row-width.test.mjs.
import { pass, fail, NODE, ROOT, isolatedBatchStatePath, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|-----|';
const row = (n, url) => `| ${n} | 2026-08-01 | Co${n} | Engineer | 4.0/5 | Evaluated | ❌ | [${n}](reports/${n}-co.md) | note | ${url} |`;

function backfill(rows, reports) {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-placeholder-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    for (const [name, body] of Object.entries(reports)) writeFileSync(join(dir, 'reports', name), body);
    const tracker = join(dir, 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs'), '--backfill-urls'], {
      cwd: dir, encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: join(dir, 'none'), CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(join(dir, 'none')) },
    });
    const text = readFileSync(tracker, 'utf-8');
    const urlCell = (n) => (text.split('\n').find((l) => l.startsWith(`| ${n} |`)) || '').split('|').map((c) => c.trim())[10];
    return { output, urlCell };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REPORTS = {
  '1-co.md': '**URL:** https://job-boards.greenhouse.io/co1/jobs/1001\n',
  '2-co.md': '**URL:** https://job-boards.greenhouse.io/co2/jobs/2002\n',
  '3-co.md': '**URL:** N/A\n',
  '4-co.md': '**URL:** https://job-boards.greenhouse.io/co4/jobs/4004\n',
  '5-co.md': '**URL:** https://job-boards.greenhouse.io/co5/jobs/5005\n',
};

console.log('\nmerge-tracker --backfill-urls — a placeholder URL cell is not "already set"');

const r = backfill([row(1, '—'), row(2, 'N/A'), row(3, 'N/A'), row(4, 'local:jds/co4-engineer.md'), row(5, '')], REPORTS);

ok('a "—" or "N/A" cell is filled from the report that names the posting', () => {
  // THE BUG: both were counted as already set and left as they were.
  assert.match(r.urlCell(1), /\(https:\/\/job-boards\.greenhouse\.io\/co1\/jobs\/1001\)/, r.urlCell(1));
  assert.match(r.urlCell(2), /\(https:\/\/job-boards\.greenhouse\.io\/co2\/jobs\/2002\)/, r.urlCell(2));
});

ok('a placeholder the report cannot fill stays as the user wrote it', () => {
  assert.strictEqual(r.urlCell(3), 'N/A');
});

ok('a cell holding anything else is the user\'s and is left alone', () => {
  assert.strictEqual(r.urlCell(4), 'local:jds/co4-engineer.md');
});

ok('an empty cell is still filled, as before', () => {
  assert.match(r.urlCell(5), /\(https:\/\/job-boards\.greenhouse\.io\/co5\/jobs\/5005\)/, r.urlCell(5));
});

ok('the summary counts placeholders as filled, not as already set', () => {
  assert.match(r.output, /3 filled, 1 already set, 0 no\/missing report, 1 report has no \*\*URL:\*\*/, r.output);
});
