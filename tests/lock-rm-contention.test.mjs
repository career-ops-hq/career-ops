// tests/lock-rm-contention.test.mjs
//
// #2777, the EPERM half. The mkdir side of both locks already treated
// Windows' EPERM/EACCES answers as contention, but every rmSync of a lock
// artifact (the lock dir, the recover guard) was bare — and on windows-latest
// removing a directory another process is touching fails with
// EPERM/EBUSY/ENOTEMPTY, killing the writer and losing its queued item
// (run 32044401225: 2 of 30 concurrent adds died exactly there).
//
// These tests pin three things:
//   1. the contention classifiers agree on the measured Windows codes,
//   2. both locks share ONE definition (the drift between the two parallel
//      lock implementations is how this class survived two earlier fixes),
//   3. no bare rmSync of a lock artifact remains in either acquisition path.

import { readFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import { isMkdirContention, isRmContention, rmLockArtifactSync } from '../pipeline-lock.mjs';

console.log('\n🔒 lock artifacts: rm contention is contention, not death (#2777)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));
const mkErr = (code) => Object.assign(new Error(code), { code });

// ── 1. Classifier tables ─────────────────────────────────────────────
// The codes come from measured windows-latest failures, not speculation:
// EPERM (#2777 both halves), EACCES (mkdir mid-flight), EBUSY/ENOTEMPTY
// (rm of a directory with an open handle inside).
{
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']) {
    ok(isRmContention(mkErr(code)), `rm ${code} is contention`);
  }
  for (const code of ['EROFS', 'ENOSPC', 'ENOENT']) {
    ok(!isRmContention(mkErr(code)), `rm ${code} is NOT contention (real breakage must still throw)`);
  }
  for (const code of ['EEXIST', 'EPERM', 'EACCES']) {
    ok(isMkdirContention(mkErr(code)), `mkdir ${code} is contention`);
  }
  ok(!isMkdirContention(mkErr('EROFS')), 'mkdir EROFS is NOT contention');
  ok(!isRmContention(undefined) && !isRmContention(null), 'no error object is not contention');
}

// ── 2. rmLockArtifactSync on a real directory ────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'lockrm-'));
  const artifact = join(dir, 'x.lock');
  mkdirSync(artifact);
  ok(rmLockArtifactSync(artifact) === true, 'removing an existing artifact returns true');
  ok(!existsSync(artifact), 'and the artifact is gone');
  ok(rmLockArtifactSync(artifact) === true, 'removing a missing artifact is a quiet success (force semantics)');
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. One definition, two locks ─────────────────────────────────────
// tracker-utils.mjs must IMPORT the classifiers from pipeline-lock.mjs, not
// carry its own copy. Two parallel implementations of the same protocol is
// exactly how the EEXIST-only check survived in one file after the other
// learned better.
{
  const tracker = readFileSync(join(ROOT, 'tracker-utils.mjs'), 'utf-8');
  ok(
    /import\s*\{[^}]*isMkdirContention[^}]*\}\s*from\s*'\.\/pipeline-lock\.mjs'/.test(tracker),
    'tracker-utils imports the contention classifiers from pipeline-lock',
  );
  ok(
    !/function isMkdirContention/.test(tracker) && !/function isRmContention/.test(tracker),
    'tracker-utils defines no second copy of the classifiers',
  );
}

// ── 3b. "Could not look" is never "recoverable" ──────────────────────
// The third face of #2777: lockCanRecover's stat catch answered `true`
// (recoverable) to EVERY stat failure, so a Windows EPERM on a mid-flight
// directory let a caller delete a live lock created microseconds ago — its
// winner then died with ENOENT writing owner.json. Only ENOENT (genuinely
// vanished) may answer "nothing to recover"; both locks must carry the guard.
{
  for (const file of ['pipeline-lock.mjs', 'tracker-utils.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    ok(
      /return err\?\.code === 'ENOENT';/.test(src),
      `${file}: lockCanRecover's stat catch answers recoverable ONLY on ENOENT`,
    );
    ok(
      !/catch\s*\{\s*\n\s*return true;/.test(src),
      `${file}: no bare catch{return true} remains in a recovery judgment`,
    );
  }
}

// ── 4. No bare rmSync of a lock artifact in either acquisition path ──
// The helper is the only code allowed to rmSync the recover guard, and the
// only permitted direct rmSync(lockDir) is pipeline-lock's release(), which
// wraps it in its own deliberate swallow-everything catch (work is already
// done by then). A bare call anywhere else reintroduces the crash one
// refactor from now.
{
  for (const file of ['pipeline-lock.mjs', 'tracker-utils.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    const guardCalls = [...src.matchAll(/rmSync\(\s*recoverGuardDir\b/g)].length;
    ok(guardCalls === 0, `${file}: no bare rmSync(recoverGuardDir) remains (found ${guardCalls})`);
  }
  const trackerLockCalls = [...readFileSync(join(ROOT, 'tracker-utils.mjs'), 'utf-8')
    .matchAll(/rmSync\(\s*lockDir\b/g)].length;
  ok(trackerLockCalls === 0, `tracker-utils.mjs: no bare rmSync(lockDir) remains (found ${trackerLockCalls})`);
  const pipelineLockCalls = [...readFileSync(join(ROOT, 'pipeline-lock.mjs'), 'utf-8')
    .matchAll(/rmSync\(\s*lockDir\b/g)].length;
  ok(pipelineLockCalls <= 1, `pipeline-lock.mjs: at most release()'s guarded rmSync(lockDir) remains (found ${pipelineLockCalls})`);
}
