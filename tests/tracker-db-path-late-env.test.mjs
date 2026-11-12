// tests/tracker-db-path-late-env.test.mjs — openDb() must honor
// CAREER_OPS_TRACKER_DB set AFTER tracker.mjs is already in the module cache
// (#3506).
//
// tracker.mjs resolved DB_PATH at module scope. That is correct for a CLI — one
// process, one invocation, env fixed before node starts — and wrong the moment
// the module is imported rather than executed: the first importer froze the path
// for the whole process, and a later assignment to the documented override was
// silently ignored.
//
// tests/tracker-busy-timeout.test.mjs is exactly that shape. It pins the variable
// before importing tracker.mjs, but test-all.mjs imports tracker.mjs earlier in
// the same process (removeRowByNum), so under a full-suite run the pin did
// nothing and openDb() created its schema at the unpinned path — a stray
// applications.db in the repo root, or in a user's data/ if they ran the suite
// inside a live workspace. It passed either way: PRAGMA busy_timeout reads back
// 5000 no matter which file was opened, so the assertion could not tell.
//
// This suite reproduces that ordering deliberately: import FIRST, set the env
// var SECOND, then assert on the file that actually appeared on disk.
import { pass, fail } from './helpers.mjs';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

console.log('\ntracker.mjs — CAREER_OPS_TRACKER_DB honored after import (#3506)');

const work = mkdtempSync(join(tmpdir(), 'cops-db-late-'));
const before = process.env.CAREER_OPS_TRACKER_DB;

// The path a frozen DB_PATH would have used — computed the way tracker.mjs
// computes it, from the ambient env, before this suite changes anything. That is
// where the pre-fix build writes, and it is outside the fixture by definition, so
// the suite has to name it: assert nothing appeared there, and clean up if
// something did. Otherwise a FAILING run of this test leaves behind exactly the
// stray database the change is meant to prevent — and only ever removes what it
// created itself, never a real index that was already on disk.
const { getCareerOpsRoot, resolveTrackerPath } = await import('../path-resolver.mjs');
const mdPath = resolveTrackerPath(getCareerOpsRoot());
const fallbackDb = mdPath.endsWith('.md') ? mdPath.slice(0, -3) + '.db' : mdPath + '.db';
const fallbackExisted = existsSync(fallbackDb);
// Content, not just existence. On a machine where a real index already sits at
// the fallback path — a live workspace, exactly where this matters — "did a file
// appear?" can never fail, so it would prove nothing there. openDb() runs its
// CREATE TABLE statements against whatever it opens, so compare the bytes.
//
// Sidecars included, because in WAL mode they ARE where the write lands: a
// CREATE TABLE goes to fallbackDb-wal and the main file stays byte-identical
// until a checkpoint. Hashing only the main file would report "unchanged" on a
// database that had just been written to.
const FALLBACK_FILES = ['', '-wal', '-shm', '-journal'];
const fallbackSnapshot = () => FALLBACK_FILES.map((suffix) => {
  const file = fallbackDb + suffix;
  return `${suffix || '(db)'}=${existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex')
    : 'absent'}`;
}).join(' ');
const fallbackBefore = fallbackSnapshot();

try {
  const { DatabaseSync } = await import('node:sqlite');

  // 1. Import with the override ABSENT, the way an unrelated consumer would.
  //    Any module-scope resolution happens here, at the wrong path.
  delete process.env.CAREER_OPS_TRACKER_DB;
  const { openDb } = await import(new URL('../tracker.mjs', import.meta.url).href);

  // 2. Only now pin it. A module-scope const cannot see this.
  const pinned = join(work, 'applications.db');
  process.env.CAREER_OPS_TRACKER_DB = pinned;

  const db = openDb(DatabaseSync);
  try {
    existsSync(pinned)
      ? pass('openDb() opened the pinned path set after import')
      : fail(`openDb() ignored a CAREER_OPS_TRACKER_DB set after import — nothing at ${pinned} (#3506)`);

    // The index is only useful if it is a real one: prove the schema landed in
    // the pinned file rather than the file merely being touched.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
    tables.includes('applications') && tables.includes('status_events')
      ? pass('the pinned database carries the index schema (applications, status_events)')
      : fail(`pinned database is missing index tables, got: ${tables.join(', ') || 'none'}`);

    // The fixture is self-contained — the database and the sidecars SQLite may
    // create beside it, nothing else. Named exactly rather than by prefix: a
    // prefix match also accepts applications.db.bak and friends, so an
    // unexpected file could be written and still pass.
    const ALLOWED = new Set([
      'applications.db',
      'applications.db-wal',      // write-ahead log
      'applications.db-shm',      // shared-memory index for the WAL
      'applications.db-journal',  // rollback journal, in the non-WAL modes
    ]);
    const stray = readdirSync(work).filter(f => !ALLOWED.has(f));
    stray.length === 0
      ? pass('no files written beside the pinned database')
      : fail(`openDb() wrote unexpected files into the fixture: ${stray.join(', ')}`);

  } finally {
    db.close();
  }

  // The unpinned fallback is untouched, which is the whole point: #3506 was not
  // "the pin is ignored" in the abstract, it was a database appearing — or being
  // written to — somewhere nobody asked for one.
  //
  // Checked AFTER the handle is closed. A WAL database can hold the write in its
  // sidecar and only fold it into the main file on close, so a snapshot taken
  // while the connection is still open reads an in-between state.
  const fallbackAfter = fallbackSnapshot();
  if (fallbackAfter === fallbackBefore) {
    pass(fallbackExisted
      ? 'the pre-existing database at the unpinned fallback path is byte-identical'
      : 'no database created at the unpinned fallback path');
  } else if (!fallbackExisted) {
    fail(`openDb() wrote a database outside the fixture at ${fallbackDb} (#3506)`);
  } else {
    fail(`openDb() modified the pre-existing database at ${fallbackDb} — a real workspace index (#3506)\n     before: ${fallbackBefore}\n     after:  ${fallbackAfter}`);
  }
} catch (e) {
  fail(`tracker db-path late-env test crashed: ${e.message}`);
} finally {
  if (before === undefined) delete process.env.CAREER_OPS_TRACKER_DB;
  else process.env.CAREER_OPS_TRACKER_DB = before;
  // Only when this run created it. A pre-existing index belongs to whoever owns
  // the workspace — a test that tidies away real data is worse than the leak.
  if (!fallbackExisted && existsSync(fallbackDb)) {
    rmSync(fallbackDb, { force: true, maxRetries: 10, retryDelay: 100 });
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
