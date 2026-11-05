/**
 * A new tracker index commits its schema once (#5514).
 *
 * openDb() ran its six CREATE statements one at a time, so building an index
 * from nothing took six commits before a row was written, and every commit
 * flushes the rollback journal and the database to disk. That cost lands on
 * whatever builds the index first. On windows-latest it put every writer in
 * tests/tracker-writer-lock.test.mjs that rebuilds the index past the
 * harness's 10s budget: each of them flushed 28 to 30 times, and the writers
 * that never open SQLite flushed once.
 *
 * Counted, not timed. The file change counter in the database header (bytes
 * 24-27) goes up once per transaction that changed the database, in the
 * rollback-journal mode the index uses, so nothing here depends on how fast
 * the disk is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, runTracker } from '../tracker.mjs';
import { canonicalizeTrackerPath } from '../tracker-utils.mjs';

const HAS_SQLITE = await import('node:sqlite').then(() => true, () => false);
const SQLITE = HAS_SQLITE ? {} : { skip: 'node:sqlite unavailable: tracker index cases skipped' };
const { DatabaseSync } = HAS_SQLITE ? await import('node:sqlite') : {};

const SCHEMA_OBJECTS = ['applications', 'idx_apps_company', 'idx_apps_status', 'idx_events_app', 'meta', 'status_events'];

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |
| 2 | 2026-01-02 | Beta | Analyst | 3.5/5 | Applied | ❌ | [2](reports/002-beta.md) | keep |
`;

// Commits that changed the database, as the header counts them.
const commitsOf = (dbPath) => readFileSync(dbPath).readUInt32BE(24);

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'co-index-first-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { db: join(dir, 'applications.db'), tracker: join(dir, 'applications.md') };
}

function schemaObjects(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(row => row.name);
}

test('a new index commits its whole schema once', SQLITE, (t) => {
  const { db } = sandbox(t);
  const handle = openDb(DatabaseSync, db);
  const { journal_mode: journalMode } = handle.prepare('PRAGMA journal_mode').get();
  const objects = schemaObjects(handle);
  handle.close();

  // In WAL mode a commit lands in the -wal file and the counter can stay put,
  // so it would stop counting anything this test is about.
  assert.equal(journalMode, 'delete', 'the index no longer uses a rollback journal: count its commits another way');
  assert.deepEqual(objects, SCHEMA_OBJECTS);
  assert.equal(commitsOf(db), 1, 'building the schema of a new index took more than one commit');
});

test('an empty database file is built the same way as a missing one', SQLITE, (t) => {
  const { db } = sandbox(t);
  writeFileSync(db, '');
  const handle = openDb(DatabaseSync, db);
  const objects = schemaObjects(handle);
  handle.close();
  assert.deepEqual(objects, SCHEMA_OBJECTS);
  assert.equal(commitsOf(db), 1);
});

test('reopening an existing index writes nothing', SQLITE, (t) => {
  const { db } = sandbox(t);
  openDb(DatabaseSync, db).close();
  const before = readFileSync(db);
  openDb(DatabaseSync, db).close();
  assert.ok(readFileSync(db).equals(before), 'opening an index that already has its schema changed the file');
});

test('the first sync of a tracker commits twice: the schema, then the rows', SQLITE, async (t) => {
  const { db, tracker } = sandbox(t);
  writeFileSync(tracker, TRACKER);
  let stderr = '';
  const sink = { write: (s) => { stderr += s; } };
  const code = await runTracker('sync', [], {
    mdPath: canonicalizeTrackerPath(tracker), dbPath: db, stdout: sink, stderr: sink,
  });
  assert.equal(code, 0, stderr);
  assert.equal(commitsOf(db), 2, `the first sync of a new index took ${commitsOf(db)} commits`);
  // A second sync of the same index is the one commit for the rows.
  assert.equal(await runTracker('sync', [], {
    mdPath: canonicalizeTrackerPath(tracker), dbPath: db, stdout: sink, stderr: sink,
  }), 0, stderr);
  assert.equal(commitsOf(db), 3);
});

test('a new index whose schema step throws is left with no schema at all', SQLITE, (t) => {
  const { db } = sandbox(t);
  // Runs the CREATE TABLE half of the schema, then fails: the tables are
  // written inside the open transaction when the error arrives.
  class FailsAtTheIndexes extends DatabaseSync {
    exec(sql) {
      const at = sql.indexOf('CREATE INDEX');
      if (at === -1) return super.exec(sql);
      super.exec(sql.slice(0, at));
      throw new Error('injected failure after the tables');
    }
  }
  assert.throws(() => openDb(FailsAtTheIndexes, db), /injected failure after the tables/);

  // The close in openDb's catch rolled the transaction back: no table from
  // the failed build survives, so the next open builds the schema again.
  if (existsSync(db) && statSync(db).size > 0) {
    const check = new DatabaseSync(db);
    const left = schemaObjects(check);
    check.close();
    assert.deepEqual(left, [], 'a failed first build left part of the schema behind');
  }
  const handle = openDb(DatabaseSync, db);
  const objects = schemaObjects(handle);
  handle.close();
  assert.deepEqual(objects, SCHEMA_OBJECTS);
});
