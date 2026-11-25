import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.mjs';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { batchInputLockTarget } from '../sync-batch-input.mjs';

for (const kind of ['file', 'directory', 'missing-directory']) {
  test(`batch sync shares its target lock through a ${kind} symlink`, async t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-alias-')));
    let lock;
    try {
      const directory = join(root, 'batch');
      mkdirSync(directory);
      const input = join(directory, 'input.tsv');
      const before = 'id\turl\tsource\tnotes\n1\thttps://example.com/old\tmanual\tkeep\n';
      if (kind !== 'missing-directory') writeFileSync(input, before);
      const alias = join(root, kind === 'file' ? 'alias.tsv' : 'alias');
      try { symlinkSync(kind === 'file' ? input : directory, alias, kind === 'file' ? 'file' : 'junction'); }
      catch (err) {
        if (process.platform === 'win32' && err.code === 'EPERM') { t.skip('File symlinks require Windows developer mode or privileges'); return; }
        throw err;
      }
      const pipeline = join(root, 'pipeline.md');
      writeFileSync(pipeline, '## Pending\n- [ ] https://example.com/new | Fictional | Engineer\n');
      lock = await acquirePipelineLock(batchInputLockTarget(input));
      const result = spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', kind === 'file' ? alias : join(alias, 'input.tsv'), '--state', join(root, 'state.tsv')], {
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '200', CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '400' }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /pipeline lock timeout/);
      if (kind === 'missing-directory') assert.equal(existsSync(input), false, 'alias must not create input while the target lock is held');
      else assert.equal(readFileSync(input, 'utf8'), before, 'alias must not write while the target lock is held');
    } finally {
      lock?.release();
      rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}

test('batch sync rejects a dangling input symlink before creating its target', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-dangling-')));
  let lock;
  try {
    const input = join(root, 'input.tsv');
    const alias = join(root, 'alias.tsv');
    try { symlinkSync(input, alias, 'file'); }
    catch (err) {
      if (process.platform === 'win32' && err.code === 'EPERM') { t.skip('File symlinks require Windows developer mode or privileges'); return; }
      throw err;
    }
    const pipeline = join(root, 'pipeline.md');
    writeFileSync(pipeline, '## Pending\n- [ ] https://example.com/new | Fictional | Engineer\n');
    lock = await acquirePipelineLock(batchInputLockTarget(input));
    const result = spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', alias, '--state', join(root, 'state.tsv')], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '200', CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '400' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /ENOENT/);
    assert.equal(existsSync(input), false, 'a rejected alias must not create the target');
  } finally {
    lock?.release();
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('batch sync can still create an ordinary missing nested input', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-new-')));
  try {
    const input = join(root, 'new', 'nested', 'input.tsv');
    const pipeline = join(root, 'pipeline.md');
    writeFileSync(pipeline, '## Pending\n- [ ] https://example.com/new | Fictional | Engineer\n');
    const result = spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', input, '--state', join(root, 'state.tsv')], {
      env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(readFileSync(input, 'utf8'), /1\thttps:\/\/example.com\/new\tpipeline\t/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
