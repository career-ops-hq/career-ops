/**
 * check-liveness.test.mjs — CLI help tests for check-liveness.mjs
 *
 * Run: node check-liveness.test.mjs
 */

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptPath = fileURLToPath(new URL('./check-liveness.mjs', import.meta.url));
let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

const helpOut = execFileSync('node', [scriptPath, '--help'], {
  encoding: 'utf-8',
  timeout: 10000,
});
ok('--help prints usage', helpOut.includes('Usage:'));
ok('--help documents --no-fallback', helpOut.includes('--no-fallback'));
ok('--help documents --throttle', helpOut.includes('--throttle'));
ok('--help documents --file', helpOut.includes('--file'));
ok('--help documents --help', helpOut.includes('--help'));
ok('--help documents -h', helpOut.includes('node check-liveness.mjs -h'));

const hOut = execFileSync('node', [scriptPath, '-h'], {
  encoding: 'utf-8',
  timeout: 10000,
});
ok('-h prints usage', hOut.includes('Usage:'));

const helpWithMissingFile = execFileSync('node', [scriptPath, '--help', '--file', '/definitely/missing'], {
  encoding: 'utf-8',
  timeout: 10000,
});
ok('--help exits before file read', helpWithMissingFile.includes('Usage:'));

try {
  execFileSync('node', [scriptPath], {
    encoding: 'utf-8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ok('no args exits non-zero', false);
} catch (err) {
  ok('no args exits 1', err.status === 1);
  ok('no args prints usage to stderr', String(err.stderr).includes('Usage:'));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log(failures.join('\n'));
}
process.exitCode = failed > 0 ? 1 : 0;
