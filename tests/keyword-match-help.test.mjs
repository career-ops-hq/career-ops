import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test('a missing report names the file and the example to run', (t) => {
  // The report path is resolved from the working directory, so this case has
  // to run somewhere that does not already contain that file.
  const cwd = mkdtempSync(join(tmpdir(), 'co-keyword-missing-'));
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-keyword-data-'));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  });
  const result = spawnSync(process.execPath, [CLI, 'reports/no-such-role.md'], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
  });
  const example = join(dataRoot, 'reports', '001-role.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Report not found: reports\/no-such-role\.md/);
  assert.match(result.stderr, new RegExp(`Example: node keyword-match\\.mjs '?${example}'?`));
});

test('a data root with a space is one quoted argument in the example', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'co-keyword-missing-'));
  const parent = mkdtempSync(join(tmpdir(), 'co-keyword-data-'));
  const dataRoot = join(parent, 'My Data');
  mkdirSync(dataRoot);
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  });
  const result = spawnSync(process.execPath, [CLI, 'reports/no-such-role.md'], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
  });
  const quoted = `'${join(dataRoot, 'reports', '001-role.md').replace(/'/g, "'\\''")}'`;
  const pattern = quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`Example: node keyword-match\\.mjs ${pattern}`));
});
