// tests/portal-health-lock.test.mjs — portal-health-lock.mjs must provide real
// mutual exclusion for data/portal-health.tsv, including under the crash +
// contention window that stale-lock reclamation opens.
//
// A naive stat-then-rmSync-then-mkdirSync reclaim is itself a TOCTOU race:
// two callers that both judge the same lock stale can have the second one's
// rmSync delete the first one's freshly created lock, after which both
// believe they hold it -- reintroducing the very interleaving this lock
// exists to prevent. release() has the mirror-image gap: a holder whose
// operation outlived the stale window would delete whichever lock directory
// happened to be present, including another process's legitimate one.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { acquirePortalHealthLock, LockTimeoutError } from '../portal-health-lock.mjs';

console.log('\nportal-health-lock.mjs — ownership-verified locking');

const root = mkdtempSync(join(tmpdir(), 'career-ops-ph-lock-'));

try {
  // 1. A live holder blocks a second acquirer, which times out.
  {
    const p = join(root, 'data', 'portal-health.tsv');
    mkdirSync(dirname(p), { recursive: true });
    const held = await acquirePortalHealthLock(p, { timeoutMs: 200, retryMs: 20 });
    try {
      const startedAt = Date.now();
      let threw = null;
      try {
        await acquirePortalHealthLock(p, { timeoutMs: 200, retryMs: 20 });
      } catch (e) {
        threw = e;
      }
      const elapsed = Date.now() - startedAt;
      if (threw instanceof LockTimeoutError && elapsed < 2000) {
        pass(`a live holder blocks a second acquirer, honoring the caller timeout (${elapsed}ms)`);
      } else if (!(threw instanceof LockTimeoutError)) {
        fail(`expected LockTimeoutError, got: ${threw?.constructor?.name}: ${threw?.message}`);
      } else {
        fail(`caller timeout not honored — waited ${elapsed}ms for a 200ms timeout`);
      }
    } finally {
      held.release();
    }
  }

  // 2. Fresh install: the parent data/ directory may not exist yet.
  {
    const fresh = mkdtempSync(join(tmpdir(), 'career-ops-ph-fresh-'));
    const p = join(fresh, 'data', 'portal-health.tsv');
    try {
      const lock = await acquirePortalHealthLock(p, { timeoutMs: 200, retryMs: 20 });
      lock.release();
      pass('creates a missing parent data/ directory instead of throwing ENOENT');
    } catch (e) {
      fail(`fresh install threw instead of creating data/: ${e.message}`);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  }

  // 3. Stale reclamation is serialized: exactly one of two concurrent
  //    reclaimers may end up holding the lock.
  {
    const p = join(root, 'data', 'concurrent.tsv');
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: 2147483000, // not a live pid
      token: 'crashed-holder-token',
      started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    }), 'utf-8');

    const results = await Promise.allSettled([
      acquirePortalHealthLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
      acquirePortalHealthLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    if (winners.length === 1) {
      pass('stale reclamation is serialized — exactly one concurrent reclaimer holds the lock');
    } else {
      fail(`expected exactly 1 winner, got ${winners.length} (both believe they hold the lock)`);
    }
    winners.forEach((w) => w.value.release());
    rmSync(lockDir, { recursive: true, force: true });
  }

  // 4. release() must not delete a lock another process legitimately reclaimed.
  {
    const p = join(root, 'data', 'reclaimed.tsv');
    const lockDir = `${p}.lock`;
    const first = await acquirePortalHealthLock(p, { timeoutMs: 200, retryMs: 20 });
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      token: 'a-different-owners-token',
      started_at: new Date().toISOString(),
    }), 'utf-8');

    first.release(); // must be a no-op

    const stillThere = existsSync(lockDir);
    const owner = stillThere ? JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8')) : null;
    if (stillThere && owner?.token === 'a-different-owners-token') {
      pass("release() leaves another holder's reclaimed lock intact");
    } else {
      fail("release() deleted a lock owned by a different holder");
    }
    rmSync(lockDir, { recursive: true, force: true });
  }

  // 5. A lock directory is ownerless for a moment by construction: between its
  //    mkdir and its owner.json write. The recover guard is ownerless for its
  //    whole life. Judging those on age alone lets a caller with an aggressive
  //    staleMs delete a directory created microseconds ago — stealing a
  //    winner's lock inside its acquisition window, or evicting a live guard
  //    and putting two callers inside the window the guard exists to serialize.
  {
    const p = join(root, 'data', 'ownerless.tsv');
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });   // ownerless, just created
    let stolen = false;
    try {
      const l = await acquirePortalHealthLock(p, { timeoutMs: 400, retryMs: 20, staleMs: 1 });
      stolen = true;
      l.release();
    } catch (e) {
      if (!(e instanceof LockTimeoutError)) fail(`ownerless-floor: expected LockTimeoutError, got ${e?.constructor?.name}`);
    }
    if (stolen) {
      fail('ownerless-floor: reclaimed a just-created ownerless lock despite an aggressive staleMs');
    } else {
      pass('a just-created ownerless lock is not reclaimable, however aggressive the caller staleMs');
    }
    rmSync(lockDir, { recursive: true, force: true });
  }

  // 6. The floor is a lower bound on patience, never a cap: a genuinely
  //    abandoned ownerless directory must still age out, or a crash while
  //    holding the guard would disable recovery permanently.
  {
    const p = join(root, 'data', 'aged.tsv');
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const old = (Date.now() - 60 * 60_000) / 1000;   // an hour old
    utimesSync(lockDir, old, old);
    try {
      const l = await acquirePortalHealthLock(p, { timeoutMs: 800, retryMs: 20, staleMs: 1 });
      pass('a genuinely aged ownerless lock still ages out and is reclaimable');
      l.release();
    } catch (e) {
      fail(`aged ownerless lock should be reclaimable, got ${e?.constructor?.name}: ${e?.message}`);
    }
    rmSync(lockDir, { recursive: true, force: true });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
