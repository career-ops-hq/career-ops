// Verifies the unified discovery command routes every retained operation without scanning.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const operation of ['configured', 'global', 'resolve', 'resolve-company', 'hn']) {
  const result = spawnSync(process.execPath, ['scan.mjs', operation, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${operation}: ${result.stderr}`);
  assert.match(result.stdout, /Usage:/, operation);
}
console.log('discovery command: retained operations expose no-write help');
