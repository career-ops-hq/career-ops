// tests/check-liveness.test.mjs — CLI contract for check-liveness.mjs (issue #2576).
//
// The script under test lives at the repository root, so its path is resolved
// from ROOT, not from this file's directory: the first version resolved
// ./check-liveness.mjs relative to tests/ and every CI job died with
// ERR_MODULE_NOT_FOUND before a single assertion ran.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';

console.log('\ncheck-liveness — --help/-h contract');

const scriptPath = join(ROOT, 'check-liveness.mjs');
const run = (args) => spawnSync(NODE, [scriptPath, ...args], {
  encoding: 'utf-8',
  timeout: 10000,
});

const help = run(['--help']);
if (help.status === 0) {
  pass('--help exits 0');
} else {
  fail(`--help exits 0 (got status ${help.status})`);
}
if ((help.stdout || '').includes('Usage:')) {
  pass('--help prints usage');
} else {
  fail('--help prints usage');
}
for (const flag of ['--no-fallback', '--throttle', '--file', '--help']) {
  if ((help.stdout || '').includes(flag)) pass(`--help documents ${flag}`);
  else fail(`--help documents ${flag}`);
}
if ((help.stdout || '').includes('node check-liveness.mjs -h')) pass('--help documents -h');
else fail('--help documents -h');

const h = run(['-h']);
if (h.status === 0 && (h.stdout || '').includes('Usage:')) pass('-h prints usage');
else fail('-h prints usage');
// The alias must stay byte-identical to --help or the two contracts can drift.
if (h.stdout === help.stdout) pass('-h output is byte-identical to --help');
else fail('-h output is byte-identical to --help');

const helpWithMissingFile = run(['--help', '--file', join('definitely', 'missing')]);
if (helpWithMissingFile.status === 0 && (helpWithMissingFile.stdout || '').includes('Usage:')) {
  pass('--help exits before file read');
} else {
  fail('--help exits before file read');
}

const noArgs = run([]);
if (noArgs.status === 1) pass('no args exits 1');
else fail(`no args exits 1 (got status ${noArgs.status})`);
if ((noArgs.stderr || '').includes('Usage:')) pass('no args prints usage to stderr');
else fail('no args prints usage to stderr');
