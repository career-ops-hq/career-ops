// tests/doctor-clean-stderr.test.mjs — `doctor --json` must not leak a
// subprocess's diagnostics onto stderr.
//
// AGENTS.md has every agent run `node doctor.mjs --json` on the FIRST MESSAGE of
// every session, which makes this the hottest path in the repo. checkTrackedBakFiles
// shells out to `git ls-files`, and execFileSync's default hands the child our own
// stderr — so outside a git checkout git printed
//
//     fatal: not a git repository (or any of the parent directories): .git
//
// before the catch that handles exactly that case ever ran. The JSON on stdout
// stayed valid, so nothing broke; it just told every agent, every session, that
// something was fatally wrong when nothing was.
//
// Measured in bytes rather than by matching the message, because the point is
// that NOTHING reaches stderr on a clean run — a future subprocess leaking a
// different string should redden this too.
//
// Run:  node --test tests/doctor-clean-stderr.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function doctor(cwd, target) {
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', target], {
    cwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: target, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r;
}

test('--json writes nothing to stderr outside a git checkout', () => {
  // A temp dir is not a checkout and has no checkout above it — the arrangement
  // that produced the leak, and the one a user with a data root outside the
  // repo is in every time.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-doctor-stderr-'));
  try {
    const r = doctor(dir, dir);
    assert.equal(
      r.stderr,
      '',
      `doctor --json leaked ${r.stderr.length} bytes to stderr: ${JSON.stringify(r.stderr.slice(0, 200))}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('and still produces the JSON it is asked for', () => {
  // Guard: the fix must not buy a clean stderr by suppressing the check or the
  // output. stdout has to remain a complete, parseable envelope.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-doctor-stderr-'));
  try {
    const r = doctor(dir, dir);
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(typeof j.onboardingNeeded, 'boolean');
    assert.ok(Array.isArray(j.missing), 'the envelope lost its `missing` array');
    assert.ok(Array.isArray(j.warnings), 'the envelope lost its `warnings` array');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('inside a checkout the .bak check still runs', () => {
  // The other guard. Piping git's stderr must not turn a working check into a
  // permanent skip — run against the repo itself, where git succeeds.
  const r = doctor(ROOT, ROOT);
  assert.equal(r.stderr, '', `stderr not clean inside a checkout: ${JSON.stringify(r.stderr.slice(0, 200))}`);
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.ok(
    !(j.warnings || []).some((w) => /check could not run/i.test(String(w))),
    `the .bak check reported itself broken inside a real checkout: ${JSON.stringify(j.warnings)}`,
  );
});
