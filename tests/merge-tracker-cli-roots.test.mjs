// merge-tracker CLI regression coverage for help safety and split code/data roots.
//
// The CLI is intentionally exercised as a child process because importing it
// runs the merge. Every data path points at a disposable external DATA_ROOT;
// no test reads or writes the repository's user-layer fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
].join('\n');

/** Run merge-tracker against a disposable external data root. */
function runMergeTrackerCli(dataRoot, ...args) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;
  delete env.CAREER_OPS_ADDITIONS;
  delete env.CAREER_OPS_BATCH_STATE;
  const result = spawnSync(process.execPath, [join(CODE_ROOT, 'merge-tracker.mjs'), ...args], {
    cwd: CODE_ROOT,
    env,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `merge-tracker failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `merge-tracker was killed by ${result.signal}`);
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('merge-tracker --help exits before mutating tracker or additions', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-merge-help-'));
  try {
    const tracker = join(dataRoot, 'data', 'applications.md');
    const additionsDir = join(dataRoot, 'batch', 'tracker-additions');
    const addition = join(additionsDir, '002-globex.tsv');
    mkdirSync(dirname(tracker), { recursive: true });
    mkdirSync(additionsDir, { recursive: true });
    const trackerBefore = `${TRACKER_HEADER}\n| 1 | 2026-01-01 | Acme | PM | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | seeded |\n`;
    const additionBefore = '2\t2026-01-02\tGlobex\tPM\tEvaluated\t4.1/5\t❌\t[2](reports/002-globex.md)\tqueued\n';
    writeFileSync(tracker, trackerBefore);
    writeFileSync(addition, additionBefore);

    const result = runMergeTrackerCli(dataRoot, '--help');

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Usage: node merge-tracker\.mjs/);
    assert.equal(readFileSync(tracker, 'utf-8'), trackerBefore, '--help rewrote the tracker');
    assert.equal(readFileSync(addition, 'utf-8'), additionBefore, '--help rewrote or archived the pending TSV');
    assert.equal(existsSync(join(additionsDir, 'merged')), false, '--help created the merged archive directory');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('merge-tracker resolves executable post-hook from code root and PDF data from external DATA_ROOT', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-merge-external-root-'));
  try {
    const tracker = join(dataRoot, 'data', 'applications.md');
    mkdirSync(dirname(tracker), { recursive: true });
    writeFileSync(
      tracker,
      `${TRACKER_HEADER}\n| 7 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ❌ | [12](../reports/012-acme.md) | seeded |\n`,
    );
    writeFileSync(
      join(dataRoot, 'data', 'pdf-index.tsv'),
      '# report\tpdf\thtml\tformat\tdate\n012\toutput/cv-acme.pdf\toutput/cv-acme.html\tletter\t2026-01-04\n',
    );

    const result = runMergeTrackerCli(dataRoot);
    const trackerAfter = readFileSync(tracker, 'utf-8');

    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /Failed to sync PDF flags/);
    assert.match(trackerAfter, /\| ✅ \| \[12\]\(\.\.\/reports\/012-acme\.md\) \|/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
