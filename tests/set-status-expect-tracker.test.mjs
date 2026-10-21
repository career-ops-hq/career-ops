import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';

const SCRIPT = join(ROOT, 'set-status.mjs');
const TRACKER = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-09-01 | Example Labs | Backend Engineer | 4/5 | Applied | - | - | résumé reviewed |',
  '| 2 | 2026-09-01 | Sample Systems | Data Engineer | 4/5 | Applied | - | - | - |',
  '',
].join('\n');
const digest = (content) => createHash('sha256').update(content, 'utf8').digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-status-expect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  mkdirSync(data);
  const tracker = join(data, 'applications.md');
  writeFileSync(tracker, TRACKER);
  return {
    root, data, tracker,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: tracker },
  };
}

function run(f, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], {
    cwd: f.root, env: f.env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.signal, null, r.stderr);
  return { ...r, json: JSON.parse(r.stdout) };
}

test('matching UTF-8 tracker digest atomically writes status and receipt note', (t) => {
  const f = fixture(t);
  const receipt = `[reply-proposal:${'a'.repeat(64)}]`;
  const r = run(f, '--row', '1', 'interview', '--expect-tracker', digest(TRACKER), '--note', receipt, '--source', 'reply-watch');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.changed, true);
  assert.equal(r.json.newStatus, 'Interview');
  const content = readFileSync(f.tracker, 'utf8');
  assert.ok(content.includes(`| Interview | - | - | résumé reviewed; ${receipt} |`));
  assert.equal(readFileSync(join(f.data, 'status-log.tsv'), 'utf8').trim().split('\n').length, 1);
});

test('a change on a different row rejects the stale snapshot without any writes', (t) => {
  const f = fixture(t);
  const changed = TRACKER.replace('Sample Systems', 'Another Example');
  writeFileSync(f.tracker, changed);
  const r = run(f, '--row', '1', 'interview', '--expect-tracker', digest(TRACKER), '--note', 'must not append');
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.json.code, 'tracker-changed');
  assert.equal(readFileSync(f.tracker, 'utf8'), changed);
  assert.equal(existsSync(join(f.data, 'status-log.tsv')), false);
});

test('stale digest also refuses an otherwise idempotent or forced update', (t) => {
  const f = fixture(t);
  const r = run(f, '--row', '1', 'applied', '--expect-tracker', digest(`${TRACKER}\n`), '--force');
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.json.code, 'tracker-changed');
  assert.equal(readFileSync(f.tracker, 'utf8'), TRACKER);
  assert.equal(existsSync(join(f.data, 'status-log.tsv')), false);
});

test('dry-run checks the same digest but never writes', (t) => {
  const f = fixture(t);
  const good = run(f, '--row', '1', 'interview', '--expect-tracker', digest(TRACKER), '--dry-run');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.json.dryRun, true);
  const stale = run(f, '--row', '1', 'interview', '--expect-tracker', digest(`${TRACKER}\n`), '--dry-run');
  assert.equal(stale.status, 3, stale.stderr);
  assert.equal(stale.json.code, 'tracker-changed');
  assert.equal(readFileSync(f.tracker, 'utf8'), TRACKER);
  assert.equal(existsSync(join(f.data, 'status-log.tsv')), false);
});

test('invalid or missing hashes fail as usage errors before tracker access', (t) => {
  const f = fixture(t);
  f.env.CAREER_OPS_TRACKER = join(f.root, 'missing.md');
  for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`, '--dry-run']) {
    const r = run(f, '--row', '1', 'interview', '--expect-tracker', value);
    assert.equal(r.status, 1, `${JSON.stringify(value)}: ${r.stderr}`);
    assert.equal(r.json.code, 'usage');
    assert.match(r.json.error, /--expect-tracker/);
  }
  const missing = run(f, '--row', '1', 'interview', '--expect-tracker');
  assert.equal(missing.status, 1, missing.stderr);
  assert.equal(missing.json.code, 'usage');
  assert.match(missing.json.error, /Missing value/);
  assert.equal(readFileSync(f.tracker, 'utf8'), TRACKER);
});

test('concurrent writers using the same snapshot can only accept one change', async (t) => {
  const f = fixture(t);
  const expected = digest(TRACKER);
  const writeRow = (num) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--row', String(num), 'interview', '--expect-tracker', expected, '--json'], {
      cwd: f.root, env: f.env, timeout: 30_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  const results = await Promise.all([writeRow(1), writeRow(2)]);
  assert.deepEqual(results.map(r => r.status).sort(), [0, 3], JSON.stringify(results));
  for (const r of results) assert.equal(r.signal, null);
  assert.equal(JSON.parse(results.find(r => r.status === 3).stdout).code, 'tracker-changed');
  assert.equal((readFileSync(f.tracker, 'utf8').match(/\| Interview \|/g) ?? []).length, 1);
  assert.equal(readFileSync(join(f.data, 'status-log.tsv'), 'utf8').trim().split('\n').length, 1);
});
