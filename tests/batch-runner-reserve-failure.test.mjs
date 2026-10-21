import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';

// A failed report-number reservation (lock timeout, unwritable reports/, ...)
// makes reserve-report-num.mjs exit 1 with nothing on stdout. The runner used
// to take the empty string as the number: it launched the paid worker with a
// blank "Report number:", recorded an empty report_num cell in batch-state.tsv
// (which the next row rewrite reads back shifted, tab being IFS whitespace),
// and so reintroduced the report-number collision the shared allocator exists
// to prevent. The retry wrapper that already handles a failed reservation was
// never reached, because the helper reported success.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-reserve-fail-'));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  mkdirSync(batch);
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
  writeFileSync(join(batch, 'batch-prompt.md'), 'Test prompt');
  // localhost is refused by the JD prefetch guard before curl connects, so the
  // test never touches the network even when the reservation wrongly succeeds.
  writeFileSync(join(batch, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttp://localhost/jobs/1\ttest\tfirst\n');
  // The allocator fails with no output, as it does when it cannot take its lock.
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'process.stderr.write("reserve-report-num: lock timeout\\n");\nprocess.exitCode = 1;\n');
  for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) {
    writeFileSync(join(root, name), '// stub: the merge steps are not under test\n');
  }
  const marker = join(root, 'worker-ran');
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\necho ran > "${marker.replace(/\\/g, '/')}"\nexit 0\n`, { mode: 0o755 });
  return {
    root, batch, marker,
    run: (args) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), ...args], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
    }),
  };
}

test('a failed report-number reservation stops the offer before any worker is launched', () => {
  const f = fixture();
  try {
    const result = f.run(['--model', 'test-model']);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `the run reported success:\n${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(f.marker), false, 'a worker was launched without a report number');
    assert.match(result.stdout + result.stderr, /Report-number reservation failed after 3 attempts/);

    const statePath = join(f.batch, 'batch-state.tsv');
    const state = existsSync(statePath) ? readFileSync(statePath, 'utf8') : '';
    assert.doesNotMatch(state, /\t\t/, `batch-state.tsv carries an empty cell:\n${JSON.stringify(state)}`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
