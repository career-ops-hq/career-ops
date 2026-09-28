// tracker-lock.ts imports `@/lib/career-ops` (the path alias), which plain
// `node --test` cannot resolve without the Next.js build — same constraint as
// pipeline.ts, same workaround already established in
// tests/lib/pipeline-local-today.test.mjs: read the source and assert the
// shape of the catch block directly.
//
// Covers: withTrackerLock's acquire-failure catch used to be unconditional
// (`catch { throw new TrackerBusyError(); }`), converting EVERY error from
// acquiring the lock — including a genuine ENOENT from a missing lock-dir
// parent, or EACCES — into "tracker is being written by another process,
// retry". That is false for those cases: they never resolve by retrying. The
// sibling followups-lock.ts already gets this right (discriminates on the
// core's SeedError('LOCK_TIMEOUT')); tracker-lock.ts's core equivalent tags a
// plain Error with `.code = 'LOCK_TIMEOUT'` instead (tracker-utils.mjs), so
// the discriminator here is `err.code === 'LOCK_TIMEOUT'`.
//
// Run:  node --test tests/lib/tracker-lock-error-classification.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "src", "lib", "core", "tracker-lock.ts");
const src = readFileSync(SRC, "utf8");

function acquireCatchBlock() {
  // The catch immediately after the `acquire(...)` call, up to its closing
  // brace before the `try { return await fn(); }` that follows.
  const m = src.match(/lock = await acquire\([\s\S]*?\}\)\s*;\s*\}\s*catch[\s\S]*?\n {2}\}/);
  assert.ok(m, `${SRC}: could not find the acquire()/catch block — the function was restructured. Update this extractor.`);
  return m[0];
}

test("the acquire-failure catch block still exists at the shape this test extracts", () => {
  assert.ok(acquireCatchBlock().length > 0);
});

test("a bare catch-all that converts every acquire error to TrackerBusyError is gone", () => {
  const block = acquireCatchBlock();
  assert.doesNotMatch(
    block,
    /catch\s*\{\s*throw new TrackerBusyError\(\);\s*\}/,
    `${SRC}: the acquire-failure catch is unconditional again — every error (ENOENT, EACCES, a broken ` +
      `checkout) gets reported as transient lock contention, which is false for anything that isn't ` +
      `LOCK_TIMEOUT. Discriminate on err.code before converting.`,
  );
});

test("TrackerBusyError is thrown only for the core's LOCK_TIMEOUT tag", () => {
  const block = acquireCatchBlock();
  assert.match(
    block,
    /err\s*&&\s*err\.code\s*===\s*["']LOCK_TIMEOUT["']/,
    `${SRC}: expected the catch to check err.code === 'LOCK_TIMEOUT' before throwing TrackerBusyError.`,
  );
});

test("anything not tagged LOCK_TIMEOUT propagates as-is, not swallowed", () => {
  const block = acquireCatchBlock();
  assert.match(
    block,
    /throw e;\s*\}\s*$/,
    `${SRC}: expected a final "throw e;" so a non-timeout error (e.g. ENOENT) reaches the caller ` +
      `unchanged instead of being converted or dropped.`,
  );
});

// --- Pins the underlying contract this fix depends on: the core function
// tracker-lock.ts wraps must NOT tag a non-contention failure as LOCK_TIMEOUT.
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
    // withTrackerLock's catch then reports that as TrackerBusyError, same as
    // genuine contention. Known, accepted, not a gap this fix introduces.
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
