// tests/cv-sync-check.test.mjs — the setup validator has to reach its checks.
//
// cv-sync-check.mjs threw a ReferenceError at module scope (#3440): the
// CODE_ROOT/DATA_ROOT split left three `join(projectRoot, …)` call sites naming
// an identifier that no longer existed, so `npm run sync-check` died before the
// first check and printed a stack instead of a report.
//
// It sat because a crash and a correct run look identical from outside. The
// script exits 1 when cv.md is missing — which is normal in this repo — and
// exits 1 on a ReferenceError too. test-all.mjs's own entry says as much:
//
//   { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }
//
// (`expectExit` is not read by the runner at all; `allowFail` was doing the
// work, and it excused everything.) So this asserts what an exit code cannot:
// that the run produced the validator's REPORT rather than a stack trace.
//
// Run:  node --test tests/cv-sync-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Run the validator against a throwaway DATA root, leaving the repo alone. */
function runAgainst(dataRoot) {
  const r = spawnSync(process.execPath, [join(ROOT, 'cv-sync-check.mjs')], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Node prints an uncaught error as `SomeError: …` plus a stack. */
function looksLikeCrash(text) {
  return /^[A-Za-z]*Error(?: \[[^\]]+\])?: /m.test(text) && /\n\s+at /.test(text);
}

test('it reaches its checks instead of throwing at module scope', () => {
  // The regression itself. Nothing here is about WHAT it reports — only that it
  // got far enough to report anything.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    assert.ok(!looksLikeCrash(r.all), `crashed instead of running:\n${r.all.slice(0, 400)}`);
    assert.match(r.stdout, /career-ops sync check/, 'no report header — the run never reached its checks');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a missing cv.md is reported as an error, not a crash', () => {
  // The legitimate non-zero exit, which is what makes the crash invisible: both
  // leave status 1. The difference is that this one says something useful.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /cv\.md not found/);
    assert.ok(!looksLikeCrash(r.all));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a complete setup passes', () => {
  // The other side, so "always errors" cannot satisfy the tests above.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), `# Jane Roe\n\n## Experience\n\n${'Backend engineer. '.repeat(12)}\n`);
    writeFileSync(join(dir, 'config', 'profile.yml'),
      'candidate:\n  full_name: "Jane Roe"\n  email: jane@example.com\n  location: Lisbon\n');
    const r = runAgainst(dir);
    assert.ok(!looksLikeCrash(r.all), r.all.slice(0, 400));
    assert.equal(r.status, 0, `expected a clean pass, got ${r.status}:\n${r.all.slice(0, 400)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('the prompt-file checks read the CODE root, not the data root', () => {
  // What the three broken call sites were for. modes/ and batch/ ship with the
  // code, so an externalized data root (the whole point of CAREER_OPS_ROOT)
  // must not make them unreadable — pointing DATA_ROOT at an empty directory
  // must not produce "file not found" warnings for them.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    for (const name of ['_shared.md', '_writing.md', 'batch-prompt.md']) {
      assert.doesNotMatch(r.all, new RegExp(`${name.replace('.', '\\.')} not found`),
        `${name} was looked for under the DATA root instead of the code root`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
