// `--throttle=8000` is in scan.mjs's own usage text and header, and modes point
// users at it for rate-limited boards, but validateFlags refuses `=` on any flag
// outside VALUE_FLAGS, so the documented form exited 1 before the scan began.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV', 'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

// An empty data root: with no portals.yml a run that gets past the flags stops
// there, before any network.
function scan(...args) {
  const root = mkdtempSync(join(tmpdir(), 'scan-throttle-'));
  try {
    const env = { ...process.env, CAREER_OPS_ROOT: root };
    delete env.FORCE_COLOR;
    for (const key of OVERRIDES) env[key] = '';
    const r = spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    return { status: r.status, error: r.error, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Past the flags, the run stops at the missing portals.yml. That message, not
// only the absence of a flag error, shows the form was accepted: a crash or a
// timeout prints no flag error either.
function assertAccepted(r) {
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /portals\.yml not found/);
}

test('the documented --throttle=<ms> gets past flag validation', () => {
  for (const flag of ['--throttle=8000', '--throttle=08000']) assertAccepted(scan('--verify', flag, '--dry-run'));
});

test('the bare form still does', () => {
  assertAccepted(scan('--verify', '--throttle', '--dry-run'));
});

test('a value that is not a positive number is still refused', () => {
  for (const flag of ['--throttle=abc', '--throttle=0', '--throttle=000', '--throttle=-5', '--throttle=']) {
    assert.match(scan('--verify', flag, '--dry-run').output, /unrecognized flag/i, flag);
  }
});

test('the flag after --throttle is not swallowed as its value', () => {
  assert.match(scan('--throttle', '--bogus').output, /unrecognized flag\(s\): --bogus/i);
});

test('a space-separated positive number is the base, not the 5000 default', async () => {
  const { readThrottleBaseMs } = await import('../scan.mjs');
  assert.deepEqual(readThrottleBaseMs(['--verify', '--throttle', '8000', '--dry-run']), { ms: 8000, consumedIndex: 2 });
  assert.deepEqual(readThrottleBaseMs(['--throttle=8000']), { ms: 8000, consumedIndex: null });
  assert.deepEqual(readThrottleBaseMs(['--verify', '--throttle', '--dry-run']), { ms: 5000, consumedIndex: null });
  assert.deepEqual(readThrottleBaseMs(['--dry-run']), { ms: 0, consumedIndex: null });
  assertAccepted(scan('--verify', '--throttle', '8000', '--dry-run'));
});

test('an equals-form value past the safe integer range is an error', async () => {
  const { readThrottleBaseMs } = await import('../scan.mjs');
  const raw = '99999999999999999999';
  assert.deepEqual(readThrottleBaseMs([`--throttle=${raw}`]), {
    error: `Error: --throttle expects a positive number of milliseconds, got "${raw}"`,
  });
  const r = scan('--verify', `--throttle=${raw}`, '--dry-run');
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /--throttle expects a positive number of milliseconds/);
  assert.doesNotMatch(r.output, /portals\.yml not found/);
});

test('a word after --throttle is refused and does not fall back to 5000', async () => {
  const { readThrottleBaseMs } = await import('../scan.mjs');
  assert.deepEqual(
    readThrottleBaseMs(['--throttle', 'abc']),
    { error: 'Error: --throttle expects a positive number of milliseconds, got "abc"' },
  );
  const r = scan('--verify', '--throttle', 'abc', '--dry-run');
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /--throttle expects a positive number of milliseconds, got "abc"/);
  assert.doesNotMatch(r.output, /portals\.yml not found/);
});
