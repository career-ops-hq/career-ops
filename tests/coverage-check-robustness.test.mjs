/**
 * tests/coverage-check-robustness.test.mjs — coverage-check.mjs on input a user
 * can legitimately hand it.
 *
 *   1. A pasted URL carrying a stray % ("100%-remote") is not a valid escape.
 *      atsFromUrl ran decodeURIComponent over every path segment and threw an
 *      uncaught URIError, so the command died with a stack trace.
 *   2. A data root with no portals.yml (a fresh install) died in readFileSync
 *      with an ENOENT stack trace instead of saying what is missing.
 */

import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { atsFromUrl } from '../coverage-check.mjs';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\ncoverage-check.mjs — malformed percent escape and missing portals.yml');

try {
  const r = atsFromUrl('https://boards.greenhouse.io/acme/jobs/50%-remote');
  if (r.ats === 'greenhouse' && r.slug === 'acme') pass('a stray % in the path does not throw, and the board is still read');
  else fail(`atsFromUrl gave ${JSON.stringify(r)}`);
} catch (err) {
  fail(`atsFromUrl threw on a stray %: ${err.message}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'co-cov-'));
try {
  mkdirSync(join(tmp, 'data'), { recursive: true });
  const run = spawnSync(NODE, [join(ROOT, 'coverage-check.mjs'), 'https://jobs.lever.co/acme/1', '--company', 'Acme', '--title', 'Engineer'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, CAREER_OPS_ROOT: tmp, CAREER_OPS_PORTALS: '' },
  });
  if (run.status === 1 && /portals\.yml not found/.test(run.stderr) && !/at readFileSync|ENOENT/.test(run.stderr)) {
    pass('a data root without portals.yml exits 1 with a plain message, not a stack trace');
  } else {
    fail(`status ${run.status}; stderr: ${run.stderr.split('\n').slice(0, 4).join(' | ')}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
