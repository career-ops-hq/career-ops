// An empty `npm run digest` used to say only "No interviews recorded".
// After a job scan, that reads like the scan found nothing. The command
// reads interview notes, and a bad date exited 1 with no example to copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const empty = mkdtempSync(join(tmpdir(), 'co-digest-empty-'));

function run(args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'weekly-digest.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 20_000,
  });
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  return r;
}

test('empty summary points at interview notes and the scan command', () => {
  const r = run(['--summary', '--dir', empty, '--from', '2026-07-20', '--to', '2026-07-26']);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout ?? '';
  assert.match(out, /No interviews recorded/);
  assert.match(out, /interview-prep\/sessions/);
  assert.match(out, /data\/pipeline\.md/);
  assert.match(out, /CAREER_OPS_PIPELINE/);
  // --dry-run saves nothing, so it is not the command to suggest here.
  assert.match(out, /Example: node scan\.mjs$/m);
});

test('--help says this is interview notes, not a job scan', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.match(out, /interview-prep\/sessions/);
  assert.match(out, /does not list jobs from a scan/);
  assert.match(out, /data\/pipeline\.md/);
  assert.match(out, /--dry-run previews them and saves nothing/);
});

test('a bad date exits 1 and prints a working example', () => {
  const r = run(['--summary', '--from', 'yesterday']);
  assert.equal(r.status, 1);
  const err = `${r.stderr ?? ''}${r.stdout ?? ''}`;
  assert.match(err, /YYYY-MM-DD/);
  assert.match(err, /node weekly-digest\.mjs --summary --from 2026-07-20 --to 2026-07-26/);
});
