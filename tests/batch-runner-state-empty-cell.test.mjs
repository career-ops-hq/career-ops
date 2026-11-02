import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

// update_state_unlocked rewrites every row of batch-state.tsv with
// `IFS=$'\t' read`, and a tab is IFS whitespace: the two tabs around an empty
// cell collapse into one and every later cell shifts left. A worker that dies
// without writing a byte leaves an empty log, so its error cell was empty, and
// the next offer's state update turned that row's `retries` into the error
// text and emptied the counter. get_retries then read 0 on every run, so the
// offer never reached --max-retries.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-state-empty-'));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  mkdirSync(batch);
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
  writeFileSync(join(batch, 'batch-prompt.md'), 'Test prompt');
  // localhost is refused by the JD prefetch guard before curl connects.
  writeFileSync(join(batch, 'batch-input.tsv'),
    'id\turl\tsource\tnotes\n1\thttp://localhost/jobs/1\ttest\tfirst\n2\thttp://localhost/jobs/2\ttest\tsecond\n');
  writeFileSync(join(root, 'reserve-report-num.mjs'), [
    "import fs from 'node:fs';",
    "const f = new URL('./.counter', import.meta.url);",
    "let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')); } catch {}",
    'n += 1; fs.writeFileSync(f, String(n));',
    "console.log(String(n).padStart(3, '0'));",
    '',
  ].join('\n'));
  for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) {
    writeFileSync(join(root, name), '// stub: the merge steps are not under test\n');
  }
  // A worker that dies without a byte of output.
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  return {
    root, batch,
    run: (args) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), ...args], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
    }),
  };
}

test('a worker that fails without output keeps the retry count of every state row', () => {
  const f = fixture();
  try {
    const result = f.run(['--model', 'test-model']);
    assert.ifError(result.error);
    assert.equal(result.status, 0, describeSpawn(result, `\n`));

    const rows = readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8').split('\n').filter(Boolean).slice(1);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const cells = row.split('\t');
      assert.equal(cells.length, 9, `row does not have nine cells: ${JSON.stringify(row)}`);
      assert.equal(cells[2], 'failed');
      assert.equal(cells[8], '1', `retries was lost or shifted: ${JSON.stringify(row)}`);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
