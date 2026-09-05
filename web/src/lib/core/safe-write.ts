import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// THE one place every user-layer write goes through. The core's #1 historical
// pain was data-loss (#649/#704/#920/#958); these guards make a web write
// crash-safe + non-clobbering by construction:
//   - atomic: write a UNIQUE temp file (pid + uuid → no concurrent-write race on
//     a single long-lived Next pid) in the SAME dir, then rename (atomic on POSIX),
//     so a kill mid-write can never truncate the real file.
//   - backup: optionally snapshot the prior contents to {file}.bak-{ts} before
//     overwriting, so a bad write is recoverable even though user files are gitignored.
//
// Both intermediate files carry the SAME content as the user-layer file they
// stand in for, so both have to stay unstageable: see .gitignore's `*.bak*` and
// `*.tmp*` rules and the probes in tests/user-layer-gitignored.test.mjs.
//
// NOT YET SHARED WITH THE CORE: tracker-utils.mjs renames through
// renameSyncWithRetry, which survives the Windows destination-handle contention
// #3006/#3046 catalogued. Its backoff is a BLOCKING Atomics.wait — correct for a
// CLI holding a lock, wrong inside a Next request handler, where it would stall
// the event loop for every other request. Adopting it here wants an async
// atomicWrite rather than a copy of the sync one.

export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Same shape as the core's writeFileAtomic (tracker-utils.mjs): dot-prefixed,
  // in the destination's own directory, `.tmp` suffixed. It used to be
  // `${file}.tmp-${pid}-${uuid}`, a SECOND shape that .gitignore's atomic-write
  // rule then had to cover separately — and did not.
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    // MANDATORY, and the core does the same. The temp file holds a byte-for-byte
    // copy of what was about to become cv.md / profile.yml / portals.yml, so a
    // rename that throws — Windows contention for the destination handle
    // (#3006/#3046), ENOSPC, a read-only mount — leaves the user's own CV lying
    // in the repo under a second filename, one per failure, forever. Nothing
    // else ever removes it.
    //
    // The cleanup gets its own catch because `force: true` only suppresses
    // ENOENT — never EPERM/EBUSY, which is the same contention that brought us
    // into this branch and can hold the temp file too. An unguarded rmSync
    // would then replace the real diagnosis ("rename failed: EPERM") with a
    // second-order one about a file the caller never asked about, and the
    // leaked copy is still there either way. `err` is what propagates.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing better to do: the write already failed and the caller is about
      // to hear why. The leftover is unstageable (.gitignore `*.tmp*`).
    }
    throw err;
  }
}

/** Snapshot the file (if it has content) to a timestamped .bak before a write. */
export function backup(file: string): string | null {
  try {
    const cur = fs.readFileSync(file, "utf8");
    if (!cur.trim()) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${file}.bak-${ts}`;
    fs.writeFileSync(bak, cur, "utf8");
    return bak;
  } catch {
    return null; // no prior file → nothing to back up
  }
}

/** Atomic write that first backs up any existing content. Returns the backup path. */
export function atomicWriteWithBackup(file: string, content: string): string | null {
  const bak = backup(file);
  atomicWrite(file, content);
  return bak;
}
