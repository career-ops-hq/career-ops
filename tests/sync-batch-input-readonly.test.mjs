import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

for (const kind of ['direct', 'file', 'directory']) {
  test(`batch sync appends through a ${kind} path when the target parent is read-only`, { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-readonly-')));
    const directory = join(root, 'batch');
    mkdirSync(directory);
    try {
      const input = join(directory, 'input.tsv');
      const before = 'id\turl\tsource\tnotes\n1\thttps://example.com/old\tmanual\tkeep\n';
      writeFileSync(input, before);
      chmodSync(input, 0o600);
      const alias = join(root, 'alias');
      if (kind !== 'direct') symlinkSync(kind === 'file' ? input : directory, alias);
      const pipeline = join(root, 'pipeline.md');
      writeFileSync(pipeline, '## Pending\n- [ ] https://example.com/new | Fictional | Engineer\n');
      chmodSync(directory, 0o555);
      assert.throws(() => mkdirSync(join(directory, 'permission-probe')), { code: 'EACCES' });
      const path = kind === 'direct' ? input : kind === 'file' ? alias : join(alias, 'input.tsv');
      const run = () => spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', path, '--state', join(root, 'state.tsv')], {
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '200', CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '400' }, encoding: 'utf8', timeout: 10000,
      });
      const result = run();
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const after = readFileSync(input, 'utf8');
      assert.ok(after.startsWith(before));
      assert.match(after, /2\thttps:\/\/example.com\/new\tpipeline\t/);
      const repeated = run();
      assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
      assert.equal(readFileSync(input, 'utf8'), after, 'repeat must not duplicate the appended URL');
    } finally {
      chmodSync(directory, 0o755);
      rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}
