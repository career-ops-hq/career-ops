// doctor --check-data lists the sent applications that have no archive at all,
// as check-jd-archive.mjs does.
//
// checkJdArchive() walks reports/, so an application recorded only as a
// tracker row (an agency role with a pasted description, or a row whose linked
// jds/ capture did not move with the data root) is invisible to it.
// check-jd-archive.mjs lists those rows through findUnarchivedApplications();
// doctor --check-data called only checkJdArchive() and printed
// "JD archive: 0 report(s) checked, none missing" for them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'doctor.mjs');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10 }); });

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

function makeRoot(rows) {
  const root = mkdtempSync(join(tmpdir(), 'doctor-check-data-unarchived-'));
  roots.push(root);
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), [...HEADER, ...rows, ''].join('\n'));
  return root;
}

function run(root, json) {
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  return spawnSync(process.execPath, [SCRIPT, '--check-data', ...(json ? ['--json'] : [])], {
    cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env,
  });
}

const ROWS = [
  '| 1 | 2026-11-01 | Acme | Data Engineer | N/A | Applied | ❌ | — | agency role, pasted JD |',
  '| 2 | 2026-11-02 | Beta | Backend Engineer | N/A | Evaluated | ❌ | — | not sent |',
];

test('--json lists a sent application with no report and no capture, and stays a soft finding', () => {
  const r = run(makeRoot(ROWS), true);
  assert.equal(r.error, undefined, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.jdArchive.unarchivedApplications, [
    { row: 1, company: 'Acme', role: 'Data Engineer', status: 'Applied' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(r.status, 0);
});

test('the text report names the row', () => {
  const r = run(makeRoot(ROWS), false);
  assert.equal(r.error, undefined, r.stderr);
  assert.match(r.stdout, /#1 Acme — Data Engineer \(Applied\) was sent, but no report or jds\/ capture records the posting/);
  assert.doesNotMatch(r.stdout, /Beta/);
  assert.equal(r.status, 0);
});

test('control: a root with nothing sent lists nothing', () => {
  const r = run(makeRoot([ROWS[1]]), true);
  assert.equal(r.error, undefined, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).jdArchive.unarchivedApplications ?? [], []);
});
