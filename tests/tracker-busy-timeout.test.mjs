// tests/tracker-busy-timeout.test.mjs — regression coverage for #1957.
//
// openDb() must set a non-zero SQLite busy_timeout. Without it the default is
// 0, so a CLI query, a `set-status` write and the Go TUI dashboard touching
// the derived index at the same time throw SQLITE_BUSY on the first contention
// instead of waiting for the lock to clear.
//
// The check is deterministic: open a fresh connection and read the pragma back
// with `PRAGMA busy_timeout`. No timing, no second connection — nothing flaky.
import { pass, fail } from './helpers.mjs';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\ntracker.mjs — SQLite busy_timeout (#1957)');

// openDb reads DB_PATH once at import time, so point it at a throwaway file
// before importing tracker.mjs — the test never touches a real applications.db.
const work = mkdtempSync(join(tmpdir(), 'cops-busy-'));
process.env.CAREER_OPS_TRACKER_DB = join(work, 'applications.db');

try {
  const { DatabaseSync } = await import('node:sqlite');
  const { openDb } = await import(new URL('../tracker.mjs', import.meta.url).href);

  const db = openDb(DatabaseSync);
  const { timeout } = db.prepare('PRAGMA busy_timeout').get();
  db.close();

  if (timeout === 5000) {
    pass(`openDb() sets busy_timeout to ${timeout}ms`);
  } else {
    fail(`openDb() busy_timeout is ${timeout}, expected 5000 (SQLITE_BUSY would fire instantly under concurrent access)`);
  }
} catch (e) {
  fail(`tracker busy_timeout test crashed: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
