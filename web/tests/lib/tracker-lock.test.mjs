// The tracker lock exists to stop a LOST UPDATE, so the test has to produce one.
//
// `atomicWrite` makes the write atomic, not the read-modify-write around it: two
// writers read the same snapshot, each edits its own row, each renames its full
// copy back, and the second discards the first's change. Every call succeeds and
// the file is well-formed throughout — the only symptom is a row that silently
// reverts (#2900).
//
// This asserts the failure FIRST (unlocked writers lose data) and then that the
// lock removes it. Without the negative half, a lock that never engaged would
// pass just as happily.
//
// Run:  node --test tests/lib/tracker-lock.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CORE = process.env.CAREER_OPS_ROOT || path.join(process.cwd(), "..");
const coreLock = path.join(CORE, "tracker-utils.mjs");
const HAS_CORE = fs.existsSync(coreLock);

function makeTracker() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trklock-"));
  const file = path.join(root, "applications.md");
  fs.writeFileSync(file, [
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    "| 1 | 2026-01-01 | Acme | Eng | 4/5 | Evaluated | ❌ | — | a |",
    "| 2 | 2026-01-01 | Beta | SRE | 3/5 | Evaluated | ❌ | — | b |",
  ].join("\n") + "\n");
  return { root, file };
}

/** The route's read-modify-write, verbatim in shape: read all, edit one, write all. */
function setStatus(file, rowNum, status, pauseMs) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  return new Promise((resolve) => setTimeout(() => {
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|");
      if (parts.length < 8 || parts[1].trim() !== String(rowNum)) continue;
      parts[6] = ` ${status} `;
      lines[i] = parts.join("|");
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, lines.join("\n"));
    fs.renameSync(tmp, file);
    resolve();
  }, pauseMs));
}

const statusOf = (file, n) =>
  fs.readFileSync(file, "utf8").split("\n").find((l) => l.split("|")[1]?.trim() === String(n))?.split("|")[6]?.trim();

test("WITHOUT a lock, two concurrent writers lose one update silently", async () => {
  const { root, file } = makeTracker();
  try {
    await Promise.all([setStatus(file, 1, "Applied", 60), setStatus(file, 2, "Interview", 10)]);
    // The bug: no error, file well-formed, one row back to its old value.
    assert.equal(statusOf(file, 1), "Applied");
    assert.equal(statusOf(file, 2), "Evaluated", "expected the classic lost update to reproduce");
    assert.equal(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 4, "file stayed well-formed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WITH the core lock, both updates survive", { skip: HAS_CORE ? false : "core checkout not resolvable" }, async () => {
  const { acquireTrackerLock, trackerLockDirFor } = await import(pathToFileURL(coreLock).href);
  const { root, file } = makeTracker();
  const guarded = async (rowNum, status, pauseMs) => {
    const lock = await acquireTrackerLock(trackerLockDirFor(file), { timeoutMs: 5_000, retryMs: 25, tracker: file });
    try {
      await setStatus(file, rowNum, status, pauseMs);
    } finally {
      await lock.release();
    }
  };
  try {
    await Promise.all([guarded(1, "Applied", 60), guarded(2, "Interview", 10)]);
    assert.equal(statusOf(file, 1), "Applied");
    assert.equal(statusOf(file, 2), "Interview", "the second update was lost even under the lock");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the lock is released on a throwing path, not just the happy one", { skip: HAS_CORE ? false : "core checkout not resolvable" }, async () => {
  // A leaked lock on a long-lived server is worse than the bug: the holder's pid
  // stays alive, so the core's stale-recovery will not reclaim it.
  const { acquireTrackerLock, trackerLockDirFor } = await import(pathToFileURL(coreLock).href);
  const { root, file } = makeTracker();
  try {
    const lock = await acquireTrackerLock(trackerLockDirFor(file), { timeoutMs: 5_000, retryMs: 25, tracker: file });
    try {
      throw new Error("boom");
    } catch {
      /* the route's catch */
    } finally {
      await lock.release();
    }
    // If the lock had leaked, this second acquire would time out.
    const again = await acquireTrackerLock(trackerLockDirFor(file), { timeoutMs: 2_000, retryMs: 25, tracker: file });
    await again.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
