// A bare --ats, an empty --ats, or a leftover word used to mean every source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../scan-ats-full.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(...args) {
  const root = mkdtempSync(join(tmpdir(), 'scan-ats-args-'));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  delete env.FORCE_COLOR;
  try {
    return spawnSync(process.execPath, [join(ROOT, 'scan-ats-full.mjs'), ...args], {
      cwd: root, encoding: 'utf8', timeout: 30000, env,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a bare --ats exits before a directory sweep', () => {
  for (const args of [['--ats'], ['--ats', '--dry-run'], ['--ats='], ['--ats', ',']]) {
    const r = run(...args);
    assert.equal(r.status, 1, `${args.join(' ')} ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--ats needs a source/);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /portals\.yml not found/);
  }
});

test('an empty argument is not a full sweep', () => {
  for (const args of [[''], ['', 'greenhouse'], ['--ats', ''], ['--seeds', '']]) {
    const r = run(...args);
    assert.equal(r.status, 1, `${JSON.stringify(args)} ${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /portals\.yml not found/);
  }
  assert.match(run('').stderr, /unexpected argument ""/);
  assert.match(run('--ats', '').stderr, /--ats needs a source/);
  assert.match(run('--seeds', '').stderr, /--seeds needs a source/);
});

test('a bare source name is not a full sweep', () => {
  const r = run('greenhouse');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /unexpected argument "greenhouse"/);
  assert.match(r.stderr, /--ats greenhouse/);
});

test('a bare --seeds exits before a directory sweep', () => {
  const r = run('--seeds');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /--seeds needs a source/);
});

test('--ats greenhouse keeps the directory contract', () => {
  const opts = parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'greenhouse']);
  assert.deepEqual(opts.ats, ['greenhouse']);
  assert.equal(opts.atsExplicit, true);
  assert.equal(opts.historySeeds, false);
  assert.deepEqual(opts.seeds, []);
  assert.equal(opts.sinceDays, 3);
});

test('--since 7 is the window, not a stray word', () => {
  const opts = parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'greenhouse', '--since', '7']);
  assert.equal(opts.sinceDays, 7);
  assert.deepEqual(opts.ats, ['greenhouse']);
});

test('--ats successfactors still needs --history-seeds', () => {
  assert.throws(
    () => parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'successfactors']),
    /--ats successfactors has no public directory source.*--history-seeds/,
  );
});
