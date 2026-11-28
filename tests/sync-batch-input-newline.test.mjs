import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

test('batch sync keeps an unterminated last row on its own line', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-batch-newline-'));
  const oldUrl = 'https://example.com/old-role';
  const newUrl = 'https://example.com/new-role';
  try {
    const input = join(root, 'batch-input.tsv');
    writeFileSync(input, `id\turl\tsource\tnotes\n1\t${oldUrl}\tmanual\tkeep`);
    writeFileSync(join(root, 'pipeline.md'), `## Pending\n- [ ] ${newUrl} | Fictional Co | Engineer\n`);
    const result = spawnSync(process.execPath, [
      join(ROOT, 'sync-batch-input.mjs'),
      '--pipeline', join(root, 'pipeline.md'),
      '--input', input,
      '--state', join(root, 'state.tsv'),
    ], {
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        CAREER_OPS_TRACKER: '',
        CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '200',
        CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '400',
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = readFileSync(input, 'utf8').split('\n').filter((line) => /^\d+\t/.test(line));
    assert.deepEqual(lines.map((line) => line.split('\t').slice(0, 3)), [
      ['1', oldUrl, 'manual'],
      ['2', newUrl, 'pipeline'],
    ], readFileSync(input, 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
