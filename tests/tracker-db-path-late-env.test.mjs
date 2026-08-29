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
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
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

    // The fixture is self-contained — one db, nothing else alongside it.
    const stray = readdirSync(work).filter(f => !f.startsWith('applications.db'));
    stray.length === 0
      ? pass('no files written beside the pinned database')
      : fail(`openDb() wrote unexpected files into the fixture: ${stray.join(', ')}`);

    // And nothing was written at the unpinned fallback, which is the whole point:
    // #3506 was not "the pin is ignored" in the abstract, it was a database
    // appearing somewhere nobody asked for one.
    fallbackExisted || !existsSync(fallbackDb)
      ? pass('no database created at the unpinned fallback path')
      : fail(`openDb() wrote a database outside the fixture at ${fallbackDb} (#3506)`);
  } finally {
    db.close();
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
