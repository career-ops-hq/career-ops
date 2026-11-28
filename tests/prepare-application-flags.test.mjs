// prepare-application.mjs ignored unknown flags, so --dryrun still built a prefill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(ROOT, 'prepare-application.mjs');

function run(args) {
  const root = mkdtempSync(join(tmpdir(), 'co-prepare-flags-'));
  try {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('prepare-application.mjs --help exits 0 and does not ask for --url', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Usage:/m);
  assert.match(r.stdout, /--url/);
});

test('prepare-application.mjs rejects --dryrun before it reads a PDF', () => {
  const r = run(['--url', 'https://boards.greenhouse.io/acme/jobs/1', '--pdf', 'output/missing.pdf', '--dryrun']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unrecognized flag\(s\): --dryrun/);
  assert.match(r.stderr, /Usage:/);
  assert.match(r.stderr, /--pdf/);
  assert.doesNotMatch(r.stderr, /PDF not found/);
});
