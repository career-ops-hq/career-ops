// tests/verify-pipeline-portals-unreadable.test.mjs — a portals.yml the
// coverage check cannot read fails verify-pipeline instead of passing it.
//
// Check 15 caught every failure, a YAML syntax error included, with warn(),
// which does not change the exit code. The run ended "Pipeline OK with
// warnings" at exit 0, and the unknown-provider errors the check exists to
// report were never looked for. The sync check in the same file already treats
// a check that could not run as failed; this one now does too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

const TRACKER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|---|---|---|---|---|---|---|---|\n'
  + '| 1 | 2026-06-20 | Acme | Engineer | 4.2/5 | Evaluated | ❌ | — | n |\n';
// The second entry's `careers_url` is indented one space less than its `name`.
const BAD_YAML = 'tracked_companies:\n  - name: Acme\n    careers_url: https://jobs.ashbyhq.com/acme\n  - name: Globex\n   careers_url: https://jobs.ashbyhq.com/globex\n';

function verify({ tracker, portals }) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-pipeline-portals-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'data'));
  if (tracker) writeFileSync(join(dir, 'data', 'applications.md'), tracker);
  writeFileSync(join(dir, 'portals.yml'), portals);
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = dir;
  return spawnSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { cwd: dir, env, encoding: 'utf-8', timeout: 60000 });
}

test('an unparseable portals.yml fails the run when a tracker exists', () => {
  const r = verify({ tracker: TRACKER, portals: BAD_YAML });
  assert.match(r.stdout, /^❌ Portal coverage check could not run — portals\.yml was NOT checked: /m, describeSpawn(r));
  assert.equal(r.status, 1, describeSpawn(r));
});

test('an unparseable portals.yml fails a fresh setup with no tracker too', () => {
  const r = verify({ tracker: null, portals: BAD_YAML });
  assert.match(r.stdout, /^❌ Portal coverage check could not run/m, describeSpawn(r));
  assert.equal(r.status, 1, describeSpawn(r));
});

test('a portals.yml that parses is still checked, not reported as unreadable', () => {
  const r = verify({ tracker: TRACKER, portals: 'tracked_companies: []\n' });
  // The run must finish and the check must report its result: a timeout or a
  // crash before check 15 prints would also leave "could not run" out of stdout.
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.doesNotMatch(r.stdout, /could not run/, describeSpawn(r));
  assert.match(r.stdout, /^✅ All 0 enabled portals\.yml entries resolve to a provider$/m, describeSpawn(r));
  assert.equal(r.status, 0, describeSpawn(r));
});
