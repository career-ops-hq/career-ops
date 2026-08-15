// tests/pipeline-lock-mkdir-eperm.test.mjs — a non-EEXIST mkdir refusal is
// contention, not a fatal error (#2777).
//
// mkdir's "someone else already has this" answer is not portable. POSIX gives
// EEXIST; Windows gives EPERM/EACCES when the target is mid-flight, being
// created or removed by another process at that instant. acquirePipelineLock
// used to rethrow anything that was not EEXIST, so on windows-latest one of 30
// concurrent `agent-inbox add` processes died with
//
//   EPERM: operation not permitted, mkdir '…\agent-inbox.md.lock.recover'
//
// and its queued item was never appended. Two earlier attempts at that failure
// raised the retry budget instead (#2506, #2825), because a starving writer and
// a writer killed by EPERM both surface as `kept=29 of 30` and only the second
// one is a crash.
//
// Exercised here with a real refusal rather than a stubbed one: a parent
// directory with no write permission makes mkdir answer EACCES, which travels
// the same branch. The contract is that acquisition RETRIES and eventually
// reports a LockTimeoutError naming what it kept hitting, instead of throwing
// the raw errno straight at the caller on the first attempt.

import { mkdtempSync, mkdirSync, chmodSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { acquirePipelineLock, LockTimeoutError } from '../pipeline-lock.mjs';

console.log('\n🔒 pipeline-lock: a non-EEXIST mkdir refusal is contention, not fatal');

// Two environments cannot produce the refusal this case needs, and in both a
// green result would mean nothing. Skipping loudly beats asserting nothing
// quietly.
//
//   - root: permission bits do not apply, so mkdir simply succeeds.
//   - win32: a POSIX mode of 0o500 does not stop directory creation there.
//     Windows uses ACLs, `chmod` maps onto the read-only attribute, and that
//     attribute does not deny mkdir inside the directory, so acquisition
//     succeeds and no error is thrown at all. Measured, not assumed: this
//     case failed on windows-latest with `got undefined` while the real
//     Windows EPERM it defends against was already gone from the same run.
//
// The bug is Windows-only and the test is POSIX-only, which reads as a
// contradiction and is not one: EACCES and EPERM meet in the same branch of
// isMkdirContention(), so exercising either one covers the code path. What
// cannot be reproduced anywhere on demand is Windows' *timing* window, which
// is why this test manufactures a deterministic refusal instead of waiting
// for a race.
const cannotRefuse = (typeof process.getuid === 'function' && process.getuid() === 0)
  ? 'running as root, permission bits do not apply'
  : (process.platform === 'win32' ? 'win32: a POSIX mode cannot deny mkdir, so the refusal never happens' : null);

if (cannotRefuse) {
  console.log(`  ⏭  skipped: ${cannotRefuse}`);
} else {
  const base = mkdtempSync(join(tmpdir(), 'co-lock-eperm-'));
  const sealed = join(base, 'sealed');
  mkdirSync(sealed);
  const pipelinePath = join(sealed, 'pipeline.md');
  chmodSync(sealed, 0o500); // r-x: mkdir inside is refused with EACCES

  try {
    let thrown = null;
    try {
      await acquirePipelineLock(pipelinePath, { timeoutMs: 300, retryMs: 20 });
    } catch (err) {
      thrown = err;
    }

    if (thrown instanceof LockTimeoutError) {
      pass('a refused mkdir is retried and reported as a lock timeout, not rethrown raw');
    } else {
      fail(`expected LockTimeoutError after retrying, got ${thrown?.name}: ${thrown?.code ?? ''} ${thrown?.message ?? ''}`);
    }

    // The trade this makes is that a genuine permissions problem stops failing
    // fast, so the timeout has to carry the reason or it becomes an unexplained
    // hang. Without this the fix would swap one silent failure for another.
    if (thrown?.lastMkdirError === 'EACCES' || thrown?.lastMkdirError === 'EPERM') {
      pass(`the timeout names the refusal it kept hitting (${thrown.lastMkdirError})`);
    } else {
      fail(`timeout did not carry the mkdir errno: lastMkdirError=${JSON.stringify(thrown?.lastMkdirError)}`);
    }
  } finally {
    chmodSync(sealed, 0o700);
    rmSync(base, { recursive: true, force: true });
  }
}
