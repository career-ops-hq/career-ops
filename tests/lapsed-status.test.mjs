import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, describeSpawn } from './helpers.mjs';

const TRACKER = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 7 | 2026-10-01 | Northwind Paper | Clerk | 3.2/5 | Lapsed | ❌ | — | fictional |',
].join('\n') + '\n';

function trackerRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'lapsed-status-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), TRACKER);
  return root;
}

function run(root, script, args) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root };
  // A developer shell can point these at a real tracker. Sync would then
  // rewrite that index with the synthetic Lapsed row.
  delete env.CAREER_OPS_TRACKER;
  delete env.CAREER_OPS_TRACKER_DB;
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

test('normalize-statuses --dry-run maps Lapsed to Discarded and leaves the file', (t) => {
  const root = trackerRoot(t);
  const file = join(root, 'data', 'applications.md');
  const result = run(root, 'normalize-statuses.mjs', ['--dry-run']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /#7: "Lapsed" → "Discarded"/);
  assert.doesNotMatch(result.stdout, /unknown statuses/);
  assert.equal(readFileSync(file, 'utf8'), TRACKER);
});

test('tracker sync --check does not index Lapsed as Evaluated', (t) => {
  const root = trackerRoot(t);
  const check = run(root, 'tracker.mjs', ['sync', '--check']);
  assert.equal(check.status, 0, describeSpawn(check));
  assert.match(check.stderr, /No corruption detected/);
  assert.doesNotMatch(check.stderr, /indexed as Evaluated/);

  const sync = run(root, 'tracker.mjs', ['sync']);
  assert.equal(sync.status, 0, describeSpawn(sync));
  const query = run(root, 'tracker.mjs', ['query', '--id', '7', '--json']);
  assert.equal(query.status, 0, describeSpawn(query));
  assert.equal(JSON.parse(query.stdout)[0].status, 'Discarded');
});
