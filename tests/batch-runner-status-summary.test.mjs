// tests/batch-runner-status-summary.test.mjs — `--status --summary` prints the
// totals without the per-job table; the default and `--full` keep the table.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — --status --summary / --full');

const bash = getBash();
if (!bash) {
  pass('functional checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-status-summary-'));
  try {
    const batchDir = join(work, 'batch');
    mkdirSync(batchDir, { recursive: true });
    const runner = join(batchDir, 'batch-runner.sh');
    writeFileSync(runner, SRC);
    chmodSync(runner, 0o755);
    writeFileSync(join(batchDir, 'batch-state.tsv'), [
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
      '1\thttps://example.com/one\tcompleted\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t001\t4.5\t-\t0',
      '2\thttps://example.com/two\tskipped\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t-\t-\t-\t0',
    ].join('\n') + '\n');

    const run = (...args) => execFileSync(bash, [runner, ...args], {
      encoding: 'utf-8', timeout: 30000, env: { ...process.env, LC_ALL: 'C' },
    });
    const TABLE = /URL \/ Detail/;
    const TOTALS = /Total: 2 \| Completed: 1/;

    const def = run('--status');
    if (TOTALS.test(def) && TABLE.test(def)) pass('--status alone still prints the totals and the per-job table');
    else fail('--status alone changed: ' + def.slice(0, 200));

    const sum = run('--status', '--summary');
    if (TOTALS.test(sum) && /Average score: 4\.5\/5/.test(sum) && !TABLE.test(sum) && !/example\.com/.test(sum)) {
      pass('--status --summary prints the totals and average without the table');
    } else {
      fail('--status --summary output wrong: ' + sum.slice(0, 300));
    }

    const full = run('--status', '--summary', '--full');
    if (TABLE.test(full)) pass('a later --full brings the table back');
    else fail('--full did not restore the table');

    const rev = run('--status', '--full', '--summary');
    if (!TABLE.test(rev)) pass('the last of --full / --summary wins');
    else fail('--summary after --full still printed the table');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
