// Parity test for the web's copy of the core directory lock (#5358).
//
// web/src/lib/core/dir-lock.mjs exists because the web bundle cannot import the
// repo-root core (web/next.config.mjs pins the Turbopack root to web/). The
// other core mirrors (ascii-fold, normalize-text-key, url-key) are checked by
// running both copies over a table of inputs. That is the wrong check for a
// lock: the cases that matter are interleavings a few microseconds wide, and
// no input table reaches them. The copies drifted one fix at a time for
// exactly that reason, so this test holds the stronger line: the two files are
// identical, byte for byte. Edit lib/dir-lock.mjs, then copy it across.
//
// Run:  node --test tests/lib/dir-lock.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as web from "../../src/lib/core/dir-lock.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CORE_FILE = path.join(ROOT, "lib", "dir-lock.mjs");
const WEB_FILE = path.join(ROOT, "web", "src", "lib", "core", "dir-lock.mjs");

test("the web copy of the directory lock is byte-for-byte the core's", () => {
  const core = fs.readFileSync(CORE_FILE);
  const mirror = fs.readFileSync(WEB_FILE);
  if (core.equals(mirror)) return;
  // Name the first differing line, so the failure says what drifted.
  const coreLines = core.toString("utf8").split("\n");
  const webLines = mirror.toString("utf8").split("\n");
  const at = coreLines.findIndex((line, index) => line !== webLines[index]);
  const line = at === -1 ? Math.min(coreLines.length, webLines.length) : at;
  assert.fail(
    `web/src/lib/core/dir-lock.mjs has drifted from lib/dir-lock.mjs at line ${line + 1}:\n`
      + `  core: ${JSON.stringify(coreLines[line])}\n  web:  ${JSON.stringify(webLines[line])}\n`
      + "Edit lib/dir-lock.mjs, then copy it over the web file.",
  );
});

test("the web copy exports the same surface as the core", async () => {
  const core = await import(pathToFileURL(CORE_FILE).href);
  assert.deepEqual(Object.keys(web).sort(), Object.keys(core).sort());
});

// A smoke run of the copy the web actually loads. Byte equality already says it
// behaves like the core; this says it loads and runs from where the web imports it.
test("the web copy takes, refuses and releases a lock", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-dir-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lockDir = path.join(dir, "resource.lock");
  const held = await web.acquireDirLock(lockDir, { timeoutMs: 200, retryMs: 5, staleMs: 30_000 });
  assert.equal(web.tryAcquireDirLockSync(lockDir, { staleMs: 30_000 }), null, "a live holder is busy");
  held.release();
  const next = web.tryAcquireDirLockSync(lockDir, { staleMs: 30_000 });
  assert.ok(next, "a released lock can be taken again");
  next.release();
  assert.equal(fs.existsSync(lockDir), false);
});
