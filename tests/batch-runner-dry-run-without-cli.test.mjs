import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-dry-no-cli-'));
  const batch = join(root, 'batch');
  mkdirSync(batch);
  copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
  writeFileSync(join(batch, 'batch-prompt.md'), 'Test prompt');
  writeFileSync(join(batch, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/1\ttest\tfirst\n2\thttps://example.com/2\ttest\tsecond\n');
  const run = (args) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), ...args], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: SYSTEM_PATH },
  });
  return { root, run };
}

function cliOnSystemPath(name) {
  return spawnSync(getBash(), ['-c', `command -v ${name}`], { env: { ...process.env, PATH: SYSTEM_PATH } }).status === 0;
}

test('a dry run lists the queue when the agent CLI is not installed', { skip: cliOnSystemPath('claude') && 'claude is installed in a system directory' }, () => {
  const f = fixture();
  try {
    const result = f.run(['--dry-run', '--model', 'test-model']);
    assert.ifError(result.error);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /#1: https:\/\/example.com\/1/);
    assert.match(result.stdout, /Would process 2 offers/);
    assert.match(result.stdout, /'claude' not found in PATH/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a real run still stops when the agent CLI is not installed', { skip: cliOnSystemPath('claude') && 'claude is installed in a system directory' }, () => {
  const f = fixture();
  try {
    const result = f.run(['--model', 'test-model']);
    assert.ifError(result.error);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stdout, /ERROR: 'claude' not found in PATH/);
    assert.doesNotMatch(result.stdout, /Would process/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
