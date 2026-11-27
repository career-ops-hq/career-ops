// Unknown flags used to be ignored, and --json could become a cache directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'plugins/h1b-sponsor/check.mjs');

function run(...args) {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.H1B_API_BASE;
  delete env.H1B_INDEX_PATH;
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 15000, env,
  });
}

test('--help exits 0 and does not look up a company', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: node plugins\/h1b-sponsor\/check\.mjs/);
  assert.equal(r.stderr, '');
  assert.doesNotMatch(r.stdout, /unknown:|friendlinessTier/);
});

test('an unknown flag exits 1 before a lookup', () => {
  const r = run('--jsonn', 'Acme');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /unrecognized flag: --jsonn/);
  assert.equal(r.stdout, '');
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /unknown:|install-h1b-index/);
});

test('a value on a flag that takes none exits 1 before a lookup', () => {
  const r = run('Acme', '--json=x');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /--json does not take a value/);
  assert.equal(r.stdout, '');
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /unknown:|install-h1b-index/);
});

test('--cache-dir does not take a flag as its path', () => {
  const r = run('Acme', '--cache-dir', '--json');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /--cache-dir needs a path/);
  assert.equal(r.stdout, '');
});

test('no company name still exits 2 with usage on stderr', () => {
  const r = run();
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /Usage: node plugins\/h1b-sponsor\/check\.mjs/);
});
