// tests/outcome-explicit-cover.test.mjs — an explicit --cover is validated like
// --cv (#5273): resolved against the tracker workspace, and refused before any
// write when it is missing, a directory or empty.
//
// outcome.mjs copied the cover letter only when existsSync(flags.cover) said
// yes, from a path resolved against the process cwd. A cover letter that was not
// found was dropped without a word: the tracker row moved and the run reported
// success at exit 0. A relative path that archives the CV (--cv is resolved
// against the workspace) dropped the cover letter whenever cwd was elsewhere,
// and a directory reached copyFileSync() and crashed with a stack trace.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const TRACKER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n'
  + '| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

// The workspace and the process cwd are different folders on purpose.
function workspace() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-outcome-cover-')));
  dirs.push(dir);
  const root = join(dir, 'workspace');
  const cwd = join(dir, 'cwd');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'output'));
  mkdirSync(cwd);
  writeFileSync(join(root, 'data', 'applications.md'), TRACKER);
  writeFileSync(join(root, 'cv.md'), '# Fictional master CV\n');
  writeFileSync(join(root, 'output', 'cover-fictional.md'), 'Dear hiring manager,\n');
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'outcome.mjs'), '1', 'rejected', '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 15000 });
  return { root, run };
}

for (const kind of ['missing', 'directory', 'empty']) {
  for (const flags of [[], ['--dry-run']]) {
    const named = { missing: 'a missing file', directory: 'a directory', empty: 'an empty file' }[kind];
    test(`--cover naming ${named} returns invalid-cover and writes nothing ${flags.join(' ')}`.trim(), () => {
      const { root, run } = workspace();
      if (kind === 'empty') writeFileSync(join(root, 'output', 'empty.md'), '');
      const cover = { missing: 'output/cover-misspelled.md', directory: 'output', empty: 'output/empty.md' }[kind];
      const r = run('--cover', cover, ...flags);
      assert.equal(r.status, 1, describeSpawn(r));
      assert.equal(JSON.parse(r.stdout).code, 'invalid-cover', describeSpawn(r));
      assert.equal(readFileSync(join(root, 'data', 'applications.md'), 'utf8'), TRACKER);
      assert.equal(existsSync(join(root, 'data', 'outcomes')), false);
    });
  }
}

test('a relative --cover resolves against the tracker workspace, like --cv', () => {
  const { root, run } = workspace();
  const r = run('--cover', 'output/cover-fictional.md');
  assert.equal(r.status, 0, describeSpawn(r));
  const [dir] = readdirSync(join(root, 'data', 'outcomes'));
  assert.equal(readFileSync(join(root, 'data', 'outcomes', dir, 'submitted_cover_letter.md'), 'utf8'), 'Dear hiring manager,\n');
});
