import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'keyword-match.mjs');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('--help prints the example and exits 0', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node keyword-match\.mjs <report-file>/);
  assert.match(result.stdout, /--json/);
  assert.match(result.stdout, /--cv/);
});

test('-h is help, not a report path', () => {
  const result = run(['-h']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /Report not found/);
});

test('a missing report names the file and the example to run', () => {
  const result = run(['reports/no-such-role.md']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Report not found: reports\/no-such-role\.md/);
  assert.match(result.stderr, /node keyword-match\.mjs reports\/001-role\.md/);
});
