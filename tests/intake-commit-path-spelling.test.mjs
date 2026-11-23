// tests/intake-commit-path-spelling.test.mjs — `intake --commit` records a
// confirmed source however its path is spelled, and refuses one it cannot find.
//
// commitState() matched the scan's documents/-relative key exactly. Any other
// spelling recorded nothing and still exited 0: `./cv/master.md`, a typo, and
// `documents/cv/master.md`, the form modes/intake.md annotates each proposal
// with (`# source: documents/...`). The confirmed source stayed `new` and was
// proposed again on the next run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'intake-commit-paths-'));
  dirs.push(root);
  mkdirSync(join(root, 'documents', 'cv'), { recursive: true });
  mkdirSync(join(root, 'documents', 'diplomas'), { recursive: true });
  writeFileSync(join(root, 'documents', 'cv', 'master.md'), '# Master CV\n\nJane Doe, Platform Engineer\n');
  writeFileSync(join(root, 'documents', 'diplomas', 'msc.md'), 'MSc Computer Science, 2019\n');
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const run = (...args) => spawnSync(NODE, [join(ROOT, 'intake.mjs'), ...args], { cwd: root, env, encoding: 'utf-8', timeout: 30000 });
  const pending = () => JSON.parse(run().stdout).sources.filter((s) => s.status !== 'ingested').map((s) => s.path).sort();
  return { root, run, pending };
}

test('a path relative to documents/ with ./, or to the data root, is recorded', () => {
  const { run, pending } = workspace();
  const r = run('--commit', './cv/master.md', 'documents/diplomas/msc.md');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.stdout, /^Recorded 2 source\(s\) as ingested/m, describeSpawn(r));
  assert.deepEqual(pending(), []);
});

test('a path that names no scanned source exits 1 and records nothing', () => {
  const { root, run, pending } = workspace();
  const r = run('--commit', 'cv/mastr.md', 'diplomas/msc.md');
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /Not a scanned source: cv\/mastr\.md\. .*Nothing was recorded\./, describeSpawn(r));
  // Not even the path that was right: the user confirmed a list, and part of it is wrong.
  assert.equal(existsSync(join(root, 'data', 'intake-state.json')), false);
  assert.deepEqual(pending(), ['cv/master.md', 'diplomas/msc.md']);
});

test('the path as the scan lists it still works', () => {
  const { run, pending } = workspace();
  const r = run('--commit', 'cv/master.md');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.deepEqual(pending(), ['diplomas/msc.md']);
});
