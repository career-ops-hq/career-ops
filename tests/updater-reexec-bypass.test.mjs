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
 * with nothing but one stray env var and no --channel flag.
 *
 * The fix extracts the gate as its own pure function, trustsEnvTargetRef()
 * (true only for an authenticated marker or the more heavily guarded legacy
 * path — never the bare third disjunct alone), and apply()'s targetRef
 * ternary calls it instead of the broader isReexec.
 *
 * ── Why this file no longer drives apply() as a subprocess ──────────────
 *
 * The first version of this test spawned the real `apply()` CLI against a
 * disposable git fixture, shadowing `curl` on PATH with a stub that always
 * failed, to observe from the outside whether resolveTargetRef() actually
 * ran. That approach reached Windows CI and failed all 3 of its assertions:
 * the stub was a POSIX-shebang script with a POSIX exec bit, neither of
 * which Windows' PATHEXT-based executable resolution recognizes, so Windows
 * silently fell through to the REAL curl and ran a REAL update against the
 * real upstream repo instead of hitting the intended blocked failure.
 *
 * The next idea — reliably block curl by removing every PATH entry that
 * contains a curl-named binary, instead of shadowing it with a stub file —
 * was verified BEFORE being adopted, not assumed safe, and it also failed:
 * on this very development machine, `which git` and `which curl` both
 * resolve to /usr/bin, so removing curl's directory removes git's too.
 * That's not a POSIX-vs-Windows split; it's a per-machine/packaging fact
 * that can differ across POSIX systems as well, which makes any PATH-surgery
 * approach fundamentally unsound as a portable test mechanism, not merely
 * one bug away from working.
 *
 * resolveTargetRef() already has a real, proven-portable seam for exactly
 * this — ctx.curlGet dependency injection, used throughout
 * updater-channel-resolution.test.mjs with zero subprocess, zero PATH, zero
 * filesystem executable concerns. trustsEnvTargetRef() is even simpler: a
 * pure two-argument boolean function needing no injection seam at all. This
 * file now tests that function directly, plus a cheap source-pattern check
 * that apply() still actually calls it — so the property that mattered
 * (a bare CAREER_OPS_UPDATE_REEXEC=1 cannot skip resolveTargetRef()) is
 * pinned with no OS-specific surface left to get wrong.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { trustsEnvTargetRef } from '../update-system.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_SYSTEM_SRC = readFileSync(join(__dirname, '..', 'update-system.mjs'), 'utf-8');

console.log('\n🧪 Testing that CAREER_OPS_UPDATE_REEXEC=1 alone cannot bypass channel resolution...');

// ── The exact bypass scenario: neither an authenticated marker nor the
// guarded legacy path — i.e. isReexec's bare third disjunct alone — must
// NOT trust an env-supplied target ref.
{
  const trusted = trustsEnvTargetRef(false, false);
  if (trusted === false) {
    pass('neither authenticated nor legacy reexec proven -> does NOT trust the env target ref (resolveTargetRef() runs instead)');
  } else {
    fail(`trustsEnvTargetRef(false, false) = ${trusted}, expected false — the bypass would be open again`);
  }
}

// ── A genuine authenticated reexec (consumeReexecMarker() validated the
// marker) legitimately inherits the parent's resolved ref.
{
  const trusted = trustsEnvTargetRef(true, false);
  if (trusted === true) {
    pass('authenticated reexec (consumeReexecMarker) -> trusts the env target ref');
  } else {
    fail(`trustsEnvTargetRef(true, false) = ${trusted}, expected true`);
  }
}

// ── The more heavily guarded legacy path (isLegacyReexec(): a real lock
// file + a really-existing, correctly-named backup branch) also legitimately
// inherits it, for a pre-dating-this-env-var parent.
{
  const trusted = trustsEnvTargetRef(false, true);
  if (trusted === true) {
    pass('legacy reexec (isLegacyReexec) -> trusts the env target ref');
  } else {
    fail(`trustsEnvTargetRef(false, true) = ${trusted}, expected true`);
  }
}

// ── Wiring: apply()'s targetRef ternary must actually call this function
// with these two inputs, or the unit tests above pin a function nothing
// calls. A source-pattern check, not a behavioral one — matches this repo's
// own convention (see e.g. the batch-runner curl-prefetch tests) for pinning
// that a specific call site exists without re-running apply() itself.
{
  const wired = /trustsEnvTargetRef\(authenticatedReexec,\s*legacyReexec\)/.test(UPDATE_SYSTEM_SRC);
  if (wired) {
    pass("apply()'s targetRef ternary calls trustsEnvTargetRef(authenticatedReexec, legacyReexec)");
  } else {
    fail("apply() no longer calls trustsEnvTargetRef(authenticatedReexec, legacyReexec) — the unit tests above are pinning a function nothing uses");
  }
}
