import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';
import { envWithPathOnly } from './helpers/fake-cli.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

for (const scenario of ['exit', 'spawn', 'signal', 'success']) {
  check(`bulk tailoring reports ${scenario} and still visits the other selected jobs`, () => {
    const root = mkdtempSync(join(tmpdir(), 'batch-tailor-worker-'));
    try {
      const state = join(root, 'batch.tsv');
      const stub = join(root, 'worker.cjs');
      const calls = join(root, 'calls.jsonl');
      writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' +
        [1, 2, 3].map(n => `${n}\thttps://example.com/jobs/${n}\tcompleted\t-\t-\t00${n}\t4.5\t-\t0\n`).join(''));
      writeFileSync(stub, `
const cp = require('node:child_process');
const fs = require('node:fs');
let count = 0;
cp.spawnSync = (command, args) => {
  if (command !== 'claude') throw new Error('Unexpected executable: ' + command);
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
  count++;
  if (count !== 2 || ${JSON.stringify(scenario)} === 'success') return { status: 0 };
  if (${JSON.stringify(scenario)} === 'spawn') return { status: null, error: Object.assign(new Error('worker unavailable'), { code: 'ENOENT' }) };
  if (${JSON.stringify(scenario)} === 'signal') return { status: null, signal: 'SIGTERM' };
  return { status: 7 };
};
require('node:module').syncBuiltinESMExports();
`);
      const result = spawnSync(process.execPath, ['--require', stub, 'batch-tailor.mjs'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        // PATH is the empty sandbox: the stub above stands in for spawnSync, so
        // a real claude on this machine must not be found and resolved instead.
        env: envWithPathOnly(root, { CAREER_OPS_ROOT: root, CAREER_OPS_BATCH_STATE: state }),
      });
      assert.equal(result.error, undefined);
      assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 3);
      assert.equal((result.stdout.match(/Finished tailoring/g) || []).length, scenario === 'success' ? 3 : 2);
      assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stdout + result.stderr);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
