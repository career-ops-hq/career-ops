// tests/rejection-latency-corporate-form.test.mjs: an interview logged under the
// employer's legal name ("Copperline Freight, Inc.") must still find the tracker
// row that names the same employer without the legal form ("Copperline Freight").
//
// Run:  node --test tests/rejection-latency-corporate-form.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'rejection-latency.mjs');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-07-20 | Copperline Freight | Data Product Manager | 4.1/5 | Interview | ✅ | [1](r1.md) | n |',
  '| 2 | 2026-07-21 | Acme Logistics | Data Analyst | 4.0/5 | Interview | ✅ | [2](r2.md) | n |',
  '',
].join('\n');

const interviews = (company) => [
  '# Active Interviews',
  '',
  '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
  '|---|---|---|---|---|---|---|',
  `| ${company} | Data Product Manager | Hiring manager | 2026-09-02 11:00 | Panel | Done | |`,
  '',
].join('\n');

function run(company) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-corp-form-'));
  try {
    writeFileSync(join(dir, 'applications.md'), TRACKER);
    writeFileSync(join(dir, 'active-interviews.md'), interviews(company));
    const r = spawnSync(process.execPath, [
      SCRIPT,
      '--tracker', join(dir, 'applications.md'),
      '--file', join(dir, 'active-interviews.md'),
      '--today', '2026-10-26',
    ], { encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const flagged = (out) => out.flags.map((f) => [f.company, f.daysSinceLastInterview]);

test('an interview under the legal name flags the tracker row without it', () => {
  assert.deepEqual(flagged(run('Copperline Freight, Inc.')), [['Copperline Freight, Inc.', 54]]);
});

test('the exact company name still flags', () => {
  assert.deepEqual(flagged(run('Copperline Freight')), [['Copperline Freight', 54]]);
});

test('a different employer that shares the first word does not match', () => {
  assert.deepEqual(flagged(run('Copperline Robotics')), []);
});
