// The core tracker lock's error classification: acquireTrackerLock
// (tracker-utils.mjs) tags ONLY genuine contention with `.code = 'LOCK_TIMEOUT'`.
// A filesystem failure such as an ENOENT from a missing lock-dir parent must
// surface as itself, because retrying never resolves it (#3138).
//
// The web used to wrap this lock in lib/core/tracker-lock.ts and reported a
// LOCK_TIMEOUT as "busy, retry". The web now writes the tracker only by running
// set-status.mjs (#2901), which takes the lock itself, so the wrapper is gone;
// the contract below is what that core writer relies on.
//
// Run:  node --test tests/lib/tracker-lock-error-classification.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same core-resolution / skip-if-absent pattern as tracker-lock.test.mjs.
const CORE =
  process.env.CAREER_OPS_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const coreLock = path.join(CORE, "tracker-utils.mjs");

let acquireTrackerLock = null;
let skipCore = false;
try {
  ({ acquireTrackerLock } = await import(pathToFileURL(coreLock).href));
} catch (err) {
  const coreAbsent = !fs.existsSync(coreLock);
  const packageUnresolvable = err.url == null;
  const depsAbsent = !fs.existsSync(path.join(CORE, "node_modules"));
  if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
  if (coreAbsent) skipCore = `no core checkout at ${CORE}`;
  else if (packageUnresolvable && depsAbsent) skipCore = `core dependencies are not installed at ${CORE} (web-only checkout)`;
  else throw err;
}

test("the core: a genuine ENOENT from acquireTrackerLock is NOT tagged LOCK_TIMEOUT", { skip: skipCore }, async () => {
  const unreachableLockDir = path.join(os.tmpdir(), `no-such-parent-${Date.now()}-xyz`, "lockdir");
  await assert.rejects(
    () => acquireTrackerLock(unreachableLockDir, { timeoutMs: 2_000, retryMs: 50 }),
    (err) => {
      assert.equal(err.code, "ENOENT");
      assert.notEqual(err.code, "LOCK_TIMEOUT", "a filesystem failure must not be mistaken for lock contention");
      return true;
    },
  );
});

// Two environments cannot produce a persistent mkdir refusal, and in both a
// green result would mean nothing (same measured skip as
// tests/pipeline-lock-mkdir-eperm.test.mjs, which this mirrors):
//   - root: permission bits do not apply, mkdir simply succeeds.
//   - win32: a POSIX chmod mode maps onto the read-only attribute there, which
//     does not deny mkdir inside the directory — acquisition would succeed and
//     no refusal would ever happen. Measured on windows-latest, not assumed.
const cannotRefuse =
  typeof process.getuid === "function" && process.getuid() === 0
    ? "running as root, permission bits do not apply"
    : process.platform === "win32"
      ? "win32: a POSIX mode cannot deny mkdir, so the refusal never happens"
      : false; // NOT null — node:test's `skip` option runs the body but still
        // reports SKIP for a null value, silently discarding the result.

test(
  "the core: a PERSISTENT EACCES/EPERM is retried and eventually surfaces as LOCK_TIMEOUT, not thrown raw",
  { skip: skipCore || cannotRefuse },
  async () => {
    // This is the behavior the PR discussion documents but which had no
    // executable coverage: unlike ENOENT (immediate, untagged) an EACCES/EPERM
    // mkdir refusal is classified as CONTENTION by the core's isMkdirContention
    // (pipeline-lock.mjs, #2777) — because on Windows that is exactly what real
    // contention looks like. So a persistent (non-transient) permission problem
    // is retried like real contention would be, and only surfaces once the
    // overall timeout elapses — as LOCK_TIMEOUT, not as the raw EACCES/EPERM.
    // A caller then reports it the same as genuine contention. Known, accepted.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "trklock-eacces-"));
    const sealed = path.join(base, "sealed");
    fs.mkdirSync(sealed);
    const lockDir = path.join(sealed, "lockdir");
    fs.chmodSync(sealed, 0o500); // r-x: mkdir inside is refused with EACCES
    try {
      await assert.rejects(
        () => acquireTrackerLock(lockDir, { timeoutMs: 300, retryMs: 20 }),
        (err) => {
          assert.equal(err.code, "LOCK_TIMEOUT", `expected LOCK_TIMEOUT after retrying, got ${err.code}: ${err.message}`);
          return true;
        },
      );
    } finally {
      fs.chmodSync(sealed, 0o700);
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);
