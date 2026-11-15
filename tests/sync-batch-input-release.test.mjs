import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './helpers.mjs';
import { batchInputLockTarget } from '../sync-batch-input.mjs';

for (const scenario of ['append', 'already-queued', 'append-error']) {
  test(`batch sync preserves ${scenario} outcome when lock cleanup fails`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-release-')));
    const input = join(root, 'batch', 'input.tsv');
    try {
      const pipeline = join(root, 'pipeline.md');
      const url = 'https://example.com/cleanup';
      mkdirSync(join(root, 'batch'));
      writeFileSync(pipeline, `## Pending\n- [ ] ${url} | Fictional | Engineer\n`);
      const before = 'id\turl\tsource\tnotes\n' + (scenario === 'already-queued' ? `1\t${url}\tmanual\tkeep\n` : '');
      writeFileSync(input, before);
      const hook = join(root, 'fail-release.mjs');
      writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const remove = fs.rmSync, append = fs.appendFileSync;
let attempts = 0;
fs.rmSync = (path, ...args) => {
  if (String(path) === process.env.BATCH_LOCK) {
    attempts++;
    fs.writeFileSync(process.env.BATCH_INPUT + '.attempts', String(attempts));
    throw Object.assign(new Error('injected cleanup failure'), { code: 'EIO' });
  }
  return remove(path, ...args);
};
fs.appendFileSync = (path, ...args) => {
  if (String(path) === process.env.BATCH_INPUT && process.env.BATCH_SCENARIO === 'append-error') {
    throw Object.assign(new Error('original append failure'), { code: 'EIO' });
  }
  return append(path, ...args);
};
syncBuiltinESMExports();\n`);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', input, '--state', join(root, 'state.tsv')], {
        env: { ...process.env, CAREER_OPS_ROOT: root, BATCH_INPUT: input, BATCH_LOCK: batchInputLockTarget(input) + '.lock', BATCH_SCENARIO: scenario }, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, scenario === 'append-error' ? 1 : 0, result.stderr);
      assert.match(result.stderr, /Warning: lock cleanup failed.*injected cleanup failure/);
      assert.equal(readFileSync(input + '.attempts', 'utf8'), '1');
      if (scenario === 'append-error') assert.match(result.stderr, /Error: original append failure/);
      const after = readFileSync(input, 'utf8');
      if (scenario === 'append') {
        assert.ok(after.startsWith(before));
        assert.equal(after.split(url).length - 1, 1);
        assert.match(result.stdout, /1 entries appended/);
      } else {
        assert.equal(after, before);
      }
    } finally {
      rmSync(batchInputLockTarget(input) + '.lock', { recursive: true, force: true, maxRetries: 10 });
      rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}
