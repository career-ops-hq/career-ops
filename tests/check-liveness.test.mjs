// tests/check-liveness.test.mjs — CLI contract for check-liveness.mjs (issue #2576).
//
// The script under test lives at the repository root, so its path is resolved
// from ROOT, not from this file's directory: the first version resolved
// ./check-liveness.mjs relative to tests/ and every CI job died with
// ERR_MODULE_NOT_FOUND before a single assertion ran.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
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
for (const flag of ['--no-fallback', '--throttle', '--no-record', '--file', '--help']) {
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

// ---------------------------------------------------------------------------
// #5000 defect 2: a failed browser launch must not end the batch.
// ---------------------------------------------------------------------------
// Point Playwright at an empty browsers directory so chromium.launch fails the
// same way it does before `npx playwright install` (the reported case: a
// Playwright bump left the binaries missing and the first browser-needing URL
// aborted the whole run, losing every verdict after it). Both URLs are
// non-ATS, so both take the browser rung, and both must come back uncertain
// with the install hint while the run still exits non-zero.
console.log('\ncheck-liveness — a failed browser launch does not end the batch');
const emptyBrowsers = mkdtempSync(join(tmpdir(), 'career-ops-no-browsers-'));
const batch = spawnSync(NODE, [scriptPath, '--no-record',
  'https://careers.example.com/closed/job-1',
  'https://careers.example.com/closed/job-2',
], {
  encoding: 'utf-8',
  timeout: 30000,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers },
});
const batchOut = `${batch.stdout || ''}${batch.stderr || ''}`;
if (batch.status === 1) pass('a no-browser batch exits 1 (uncertain)');
else fail(`a no-browser batch exits 1 (got status ${batch.status})`);
if (!batchOut.includes('Fatal:')) pass('the run does not abort on the failed launch');
else fail('the run aborted on the failed launch');
if (((batch.stdout || '').match(/uncertain/g) || []).length >= 2) pass('every browser-needing URL still gets a verdict');
else fail('a URL after the failed launch lost its verdict');
if (batchOut.includes('playwright install')) pass('the reason carries the install hint');
else fail('the reason carries the install hint');
