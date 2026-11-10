// tests/merge-tracker-reused-failed-number.test.mjs — the failed-report guard
// explains a reused number instead of only calling the report fabricated (#4505).
//
// Before #4391, a failed batch worker released its report number and the next
// offer could receive it, so batch-state.tsv ends up with a "failed" and a
// "completed" row on one number. merge-tracker must still refuse that number
// (the failed worker may have written a TSV under it too), so the skip itself
// is unchanged here. What changes is the message: when a completed row shares
// the number, the warning says the number was likely reused and how to clear it.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';

console.log('\nmerge-tracker.mjs — a reused failed report number is explained, not just refused (#4505)');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const D = '2026-09-27';
const ADDITION = [
  'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes',
  ['404', D, 'Acme', 'Engineer', 'Evaluated', '4.0/5', '❌', `[404](reports/404-acme-${D}.md)`, 'note'].join('\t'),
  '',
].join('\n');

const STATE_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';
const row = (id, url, status, num) => [id, url, status, '-', '-', num, '-', '-', '0'].join('\t');

/** Merge the one addition against a given batch-state and report what happened. */
function merge(stateRows) {
  const work = mkdtempSync(join(tmpdir(), 'cops-reused-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    const state = join(work, 'batch-state.tsv');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, TRACKER);
    writeFileSync(join(adds, '404-acme.tsv'), ADDITION);
    writeFileSync(state, [STATE_HEADER, ...stateRows, ''].join('\n'));
    // The skip is a console.warn, so it lands on stderr even when the run exits 0.
    const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: state },
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const merged = readFileSync(tracker, 'utf-8').split('\n').some((l) => /^\|\s*404\s*\|/.test(l));
    return { merged, out };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const HINT = /likely reused after a failure/;

// The #4505 shape: failed row 36 kept 404, completed row 45 got it next.
const reused = merge([
  row('36', 'https://example.com/job/a', 'failed', '404'),
  row('45', 'https://example.com/job/b', 'completed', '404'),
]);
// Not merged is not enough on its own: the row must be refused BY the guard.
if (!reused.merged && /is marked "failed" in batch-state\.tsv/.test(reused.out)) pass('a number with a failed row is still refused by the guard when a completed row shares it');
else fail(`reused number: merged=${reused.merged}, guard line present=${/is marked "failed"/.test(reused.out)}`);

// Control: without batch-state rows the same addition merges, so the refusals
// above come from the guard and not from something else about the fixture.
const clean = merge([]);
if (clean.merged) pass('control: the same addition merges when batch-state has no row for its number');
else fail(`control failed, the fixture does not merge at all: ${clean.out.trim().split('\n').slice(-2).join(' | ')}`);
// Both halves: why it was refused, and the manual fix that clears it.
if (HINT.test(reused.out) && /set report_num to "-" on the failed row and re-run/.test(reused.out)) pass('the skip explains the reused number and how to clear it');
else fail(`no reuse hint in the skip warning: ${reused.out.trim().split('\n').filter((l) => /Skipping/.test(l)).join(' | ') || '(no skip line)'}`);

// Only a failed row: the fabrication case the guard was written for. No hint.
const onlyFailed = merge([row('36', 'https://example.com/job/a', 'failed', '404')]);
if (!onlyFailed.merged && /possible fabricated result/.test(onlyFailed.out)) pass('a failed-only number is refused with the original warning');
else fail(`failed-only number: merged=${onlyFailed.merged}, output: ${onlyFailed.out.trim().split('\n').pop()}`);
if (!HINT.test(onlyFailed.out)) pass('no reuse hint when no completed row shares the number');
else fail('the reuse hint fired for a number that only a failed row carries');
