/**
 * updater-reexec-bypass.test.mjs — a bare CAREER_OPS_UPDATE_REEXEC=1 must not
 * let apply() skip channel resolution.
 *
 * The regression (CodeRabbit review on the release-channel PR): isReexec's
 * third disjunct — `--confirm` in argv plus a bare CAREER_OPS_UPDATE_REEXEC=1
 * in env — proves nothing (no lock file, no authenticated marker, no backup
 * branch) and is satisfiable from a clean state. Before the fix, apply()'s
 * targetRef ternary trusted that alone to skip resolveTargetRef() entirely
 * and fall through to CAREER_OPS_UPDATE_TARGET_REF ?? 'main' — silently
 * reverting to the exact unpinned-main behavior this PR exists to close,
 * with nothing but one stray env var and no --channel flag. Manually
 * reproduced against the pre-fix code before writing this test: the process
 * actually fetched real upstream `main` and updated a throwaway install,
 * with no network call to RELEASES_API at all.
 *
 * The fix gates the targetRef fallback on (authenticatedReexec ||
 * legacyReexec) instead of the broader isReexec, so only a cryptographically
 * authenticated reexec (consumeReexecMarker()) or the more heavily guarded
 * legacy path (isLegacyReexec(): a real lock file + a really-existing,
 * correctly-named backup branch) may skip resolveTargetRef().
 *
 * apply() isn't structured for the ctx-injection seam used elsewhere in this
 * suite (it reads process.argv/process.env directly and has real git/network
 * side effects), so this drives the real CLI entrypoint as a subprocess
 * against a disposable git fixture — the smallest faithful way to observe
 * its behavior. A stub `curl` shadowing the real one on PATH makes the
 * release lookup fail deterministically (no real network needed, no
 * dependency on live connectivity in CI): if resolveTargetRef() runs, it
 * fails loudly naming RELEASES_API and --channel main, BEFORE apply() ever
 * reaches its git fetch step. If resolveTargetRef() is skipped instead, the
 * process moves on to `git fetch` — a materially different outcome, easy to
 * tell apart from the assertions below.
 *
 * Scoped to exactly this bypass, per the CodeRabbit finding. The companion
 * property — a GENUINE authenticated reexec still correctly honors
 * CAREER_OPS_UPDATE_TARGET_REF without calling resolveTargetRef() at all —
 * was verified manually (a real marker via createReexecMarker(), a real git
 * fetch of the env-supplied ref, zero curl invocations) but isn't encoded
 * here: proving it end-to-end needs a local CANONICAL_REPO mirror
 * (upgrade-tests.mjs's insteadOf trick) to avoid a live-network dependency,
 * which is more machinery than this specific regression calls for.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail, rmSync } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_SYSTEM_SRC = join(__dirname, '..', 'update-system.mjs');

/** A disposable git repo containing its own copy of update-system.mjs —
 *  apply()'s ROOT is the script's own directory, so this IS the install. */
function makeFixtureInstall() {
  const dir = mkdtempSync(join(tmpdir(), 'co-reexec-bypass-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  copyFileSync(UPDATE_SYSTEM_SRC, join(dir, 'update-system.mjs'));
  writeFileSync(join(dir, 'VERSION'), '1.0.0\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  return dir;
}

/** A `curl` that always fails, shadowing the real one so resolveTargetRef()'s
 *  release lookup fails deterministically — no live network dependency. */
function makeCurlStubBin() {
  const dir = mkdtempSync(join(tmpdir(), 'co-reexec-bypass-bin-'));
  const stub = join(dir, 'curl');
  writeFileSync(stub, '#!/bin/sh\nexit 7\n');
  chmodSync(stub, 0o755);
  return dir;
}

/** Run `apply --confirm` in the fixture with the given extra env, stubbed
 *  curl shadowing the real one. Returns {status, stdout, stderr} either way
 *  — apply() is expected to exit non-zero here, which execFileSync throws on. */
function runApply(dir, stubBin, extraEnv) {
  try {
    const stdout = execFileSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status ?? null, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

console.log('\n🧪 Testing that CAREER_OPS_UPDATE_REEXEC=1 alone cannot bypass channel resolution...');

const install = makeFixtureInstall();
const stubBin = makeCurlStubBin();
try {
  // ── Control: a normal (non-reexec) invocation must call resolveTargetRef()
  // and fail loudly when the release lookup is blocked — this proves the
  // fixture and curl stub are actually exercising the code path in question,
  // not passing for an unrelated reason.
  const control = runApply(install, stubBin, {});
  const controlCallsResolve = control.status !== 0 &&
    /releases\/latest/.test(control.stderr) &&
    /--channel main/.test(control.stderr);
  if (controlCallsResolve) {
    pass('control: a normal invocation calls resolveTargetRef() and fails loudly when it cannot reach GitHub');
  } else {
    fail(`control: expected a resolveTargetRef failure naming RELEASES_API and --channel main; got status=${control.status} stderr=${control.stderr.slice(0, 300)}`);
  }

  // ── The actual regression: CAREER_OPS_UPDATE_REEXEC=1 alone, --confirm,
  // clean state (no lock file, no marker, no backup branch) must behave
  // IDENTICALLY to the control above — not silently skip to a bare `main`
  // fetch.
  const bypassAttempt = runApply(install, stubBin, { CAREER_OPS_UPDATE_REEXEC: '1' });
  const stillCallsResolve = bypassAttempt.status !== 0 &&
    /releases\/latest/.test(bypassAttempt.stderr) &&
    /--channel main/.test(bypassAttempt.stderr);
  const neverReachedFetch = !/Fetching .* from upstream/.test(bypassAttempt.stdout);
  if (stillCallsResolve && neverReachedFetch) {
    pass('CAREER_OPS_UPDATE_REEXEC=1 alone does NOT skip resolveTargetRef() or silently resolve to main');
  } else {
    fail(
      `bare CAREER_OPS_UPDATE_REEXEC=1 changed apply()'s behavior — status=${bypassAttempt.status}, ` +
      `stdout=${bypassAttempt.stdout.slice(0, 300)}, stderr=${bypassAttempt.stderr.slice(0, 300)}`,
    );
  }
} finally {
  rmSync(install, { recursive: true, force: true });
  rmSync(stubBin, { recursive: true, force: true });
}
