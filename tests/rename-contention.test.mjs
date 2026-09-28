// tests/rename-contention.test.mjs
//
// #2777's missing third syscall. The mkdir and rm sides of both locks now treat
// Windows' EPERM/EACCES/EBUSY answers as contention, but `writeFileAtomic`'s
// closing `renameSync` was still bare — and on Windows a rename whose
// DESTINATION is open by anyone else at that instant fails with EPERM
// (errno -4048), killing the writer and losing the tracker write.
//
// POSIX `rename(2)` replaces the destination atomically and cannot fail that
// way, which is why this never reproduces on Linux/macOS CI. Measured on
// Windows 11 / Node v24.18.0: `node test-all.mjs` failed 1-2 tests per run,
// non-deterministically, in tracker-writer-lock-tests.mjs and
// set-status-tests.mjs. Both suites pass in isolation; only the full run
// manufactures enough concurrent readers to lose the race.
//
// The holder is usually not another writer of ours (the tracker lock serializes
// those) but a transient reader: an antivirus scanner, the Search indexer, or a
// concurrent readFileSync from a reporting script.
//
// These tests pin four things:
//   1. the classifier agrees on the measured Windows codes and ONLY those,
//   2. a contended rename is retried and the write completes,
//   3. a non-contention errno still fails fast, with the temp file cleaned up,
//   4. no bare renameSync remains in the tracker's atomic-write path.

import { readFileSync, existsSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  isRenameContention,
  renameSyncWithRetry,
  writeFileAtomic,
  RENAME_RETRY_DELAYS_MS,
} from '../tracker-utils.mjs';

console.log('\n📝 atomic tracker writes: rename contention is contention, not death (#2777)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));
const mkErr = (code) => Object.assign(new Error(code), { code });

// ── 1. Classifier table ──────────────────────────────────────────────────────
// The codes come from measured Windows failures, not speculation. EPERM is the
// one observed here; EACCES and EBUSY are the same family already recorded for
// mkdir/rm in pipeline-lock.mjs.
{
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    ok(isRenameContention(mkErr(code)) === true, `isRenameContention treats ${code} as contention`);
  }
  // A missing source or a cross-device move is a real failure, not a race.
  // Retrying these would turn a clear error into a ~200ms stall and a stale message.
  for (const code of ['ENOENT', 'EXDEV', 'EISDIR', 'ENOSPC']) {
    ok(isRenameContention(mkErr(code)) === false, `isRenameContention does NOT retry ${code}`);
  }
  ok(isRenameContention(undefined) === false, 'isRenameContention tolerates a missing error');
  ok(isRenameContention(new Error('no code')) === false, 'isRenameContention ignores an error with no code');
}

// ── 2. A contended rename is retried until it lands ──────────────────────────
// Injecting the rename keeps this deterministic and cross-platform: CI on Linux
// exercises the same retry loop that only Windows triggers in production.
{
  let attempts = 0;
  const flakyRename = () => {
    attempts++;
    if (attempts <= 3) throw mkErr('EPERM');
  };
  let threw = null;
  try {
    renameSyncWithRetry('from.tmp', 'to.md', flakyRename);
  } catch (err) {
    threw = err;
  }
  ok(threw === null, 'renameSyncWithRetry survives 3 EPERM answers and returns');
  ok(attempts === 4, `renameSyncWithRetry retried until success (${attempts} attempts)`);
}

// A rename that never recovers must still give up and rethrow the ORIGINAL
// error, rather than looping forever or masking it.
{
  let attempts = 0;
  const deadRename = () => {
    attempts++;
    throw mkErr('EPERM');
  };
  let code = null;
  try {
    renameSyncWithRetry('from.tmp', 'to.md', deadRename);
  } catch (err) {
    code = err.code;
  }
  ok(code === 'EPERM', 'a permanently contended rename rethrows the original EPERM');
  ok(
    attempts === RENAME_RETRY_DELAYS_MS.length + 1,
    `retries are bounded at ${RENAME_RETRY_DELAYS_MS.length} (made ${attempts} attempts)`,
  );
}

// ── 3. Non-contention errors fail fast, and the temp file never leaks ────────
{
  let attempts = 0;
  const wrongDevice = () => {
    attempts++;
    throw mkErr('EXDEV');
  };
  let code = null;
  try {
    renameSyncWithRetry('from.tmp', 'to.md', wrongDevice);
  } catch (err) {
    code = err.code;
  }
  ok(code === 'EXDEV' && attempts === 1, 'a non-contention errno fails on the first attempt');
}

// writeFileAtomic's own contract: the destination is replaced, and on failure
// no `.applications.md.<pid>.<ts>.<uuid>.tmp` is left behind.
{
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-rename-'));
  try {
    const target = join(dir, 'applications.md');
    writeFileSync(target, 'original\n');

    writeFileAtomic(target, 'replaced\n');
    ok(readFileSync(target, 'utf-8') === 'replaced\n', 'writeFileAtomic replaces the destination');
    ok(
      readdirSync(dir).filter((f) => f.endsWith('.tmp')).length === 0,
      'writeFileAtomic leaves no .tmp behind on success',
    );

    // An unwritable destination (a directory) fails; the temp file must go too.
    let failed = false;
    try {
      writeFileAtomic(join(dir), 'nope\n');
    } catch {
      failed = true;
    }
    ok(failed, 'writeFileAtomic still throws when the destination cannot be replaced');
    ok(
      readdirSync(dir).filter((f) => f.endsWith('.tmp')).length === 0,
      'writeFileAtomic cleans up its .tmp on failure',
    );
    ok(existsSync(target), 'a failed write leaves the original file intact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. No bare renameSync in the atomic-write path ───────────────────────────
// renameSyncWithRetry is the only code allowed to call renameSync in this file.
// A bare call anywhere else reintroduces the lost write one refactor from now,
// which is exactly how the mkdir/rm half of #2777 survived two earlier fixes.
{
  const src = readFileSync(join(ROOT, 'tracker-utils.mjs'), 'utf-8');

  // renameSync must never be INVOKED directly. It may only appear as the
  // imported name and as renameSyncWithRetry's default parameter, neither of
  // which is a call, so the call-site count must be zero.
  const directCalls = [...src.matchAll(/(?<![\w.])renameSync\s*\(/g)].length;
  ok(
    directCalls === 0,
    `tracker-utils.mjs: no direct renameSync() call remains (found ${directCalls})`,
  );

  // And the atomic path routes through the injectable seam exactly once.
  const seamCalls = [...src.matchAll(/^\s*rename\(tmpPath, path\);/gm)].length;
  ok(
    seamCalls === 1,
    `the atomic write renames through the injectable helper exactly once (found ${seamCalls})`,
  );
}
