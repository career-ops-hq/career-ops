// tests/check-jd-archive-assessment.test.mjs — an application in Assessment
// with nothing archived is listed with the other sent applications.
//
// findUnarchivedApplications() lists the rows that were SENT but have no
// report, no jds/ capture and no linked capture. Its SUBMITTED_LABELS set
// named Applied, Responded, Interview, Offer, Hired and Rejected, but not
// Assessment (#4317), which sits between Responded and Interview. So a row
// waiting on an online assessment, with no record of what the role asked
// for, was the one sent application the check never mentioned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { findUnarchivedApplications } from '../check-jd-archive.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

function workspace(rows) {
  const root = mkdtempSync(join(tmpdir(), 'jd-archive-assessment-'));
  dirs.push(root);
  for (const dir of ['data', 'reports', 'jds']) mkdirSync(join(root, dir));
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
  return { root, tracker, reports: join(root, 'reports'), jds: join(root, 'jds') };
}

test('an Assessment row with no archive is listed, like an Applied one', () => {
  const { tracker, reports, jds } = workspace([
    '| 1 | 2026-09-01 | Acme | Data Engineer | 4.2/5 | Applied | ❌ | — | |',
    '| 2 | 2026-09-02 | Globex | Data Engineer | 4.3/5 | Assessment | ❌ | — | |',
    '| 3 | 2026-09-03 | Initech | Analyst | 4.0/5 | Evaluated | ❌ | — | |',
  ]);
  const found = findUnarchivedApplications(tracker, reports, jds);
  assert.deepEqual(found.map((f) => [f.row, f.status]), [[1, 'Applied'], [2, 'Assessment']]);
});

test('an Assessment row whose JD is archived is not listed', () => {
  const { tracker, reports, jds } = workspace([
    '| 2 | 2026-09-02 | Globex | Data Engineer | 4.3/5 | Assessment | ❌ | [2](../reports/002-globex-2026-09-02.md) | |',
  ]);
  writeFileSync(join(reports, '002-globex-2026-09-02.md'), '# Globex\n\n## Job Description (archived verbatim)\n\nBuild data pipelines in Go and Kafka for the payments team.\n');
  assert.deepEqual(findUnarchivedApplications(tracker, reports, jds), []);
});

test('the CLI summary names the Assessment row', () => {
  const { root } = workspace([
    '| 2 | 2026-09-02 | Globex | Data Engineer | 4.3/5 | Assessment | ❌ | — | |',
  ]);
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(NODE, [join(ROOT, 'check-jd-archive.mjs'), '--summary'], { cwd: root, env, encoding: 'utf-8', timeout: 30000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.match(r.stdout, /^\s*2\s+Assessment\s+Globex\s+Data Engineer\s*$/m, describeSpawn(r));
});
