// tests/gmail-state-data-root.test.mjs — the bundled gmail plugin keeps its
// processed-id cursor under the data root, not the working directory.
//
// The cursor was `data/gmail-state.json` resolved against process.cwd(). With
// the user layer outside the checkout (CAREER_OPS_ROOT, or a .career-ops-data
// marker) that put it in whichever directory the command happened to run from:
// run the plugin from somewhere else and it found no cursor, and every message
// it had already processed was fetched and offered to the pipeline again. It
// now resolves against ctx.dataRoot (tests/plugin-ctx-data-root.test.mjs covers
// the engine putting the right root there).
//
// Each test gets a data root and a working directory of its own, both under the
// OS temp dir, and they are never the same directory: that is the only layout
// in which "under the data root" and "under the working directory" can be told
// apart. Nothing here reads or writes the checkout's own data/.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from './helpers.mjs';
import gmail from '../plugins/gmail/index.mjs';

const STATE = join('data', 'gmail-state.json');

let base, dataRoot, workDir, otherWorkDir;
const startCwd = process.cwd();

beforeEach(() => {
  // realpath: process.cwd() reports the resolved path, and on macOS the temp
  // dir is a symlink, so an unresolved fixture path would never compare equal.
  base = realpathSync(mkdtempSync(join(tmpdir(), 'gmail-state-')));
  dataRoot = join(base, 'data-root');
  workDir = join(base, 'cwd');
  otherWorkDir = join(base, 'other-cwd');
  for (const dir of [dataRoot, workDir, otherWorkDir]) mkdirSync(dir, { recursive: true });
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(startCwd);
  rmSync(base, { recursive: true, force: true });
});

/**
 * A ctx whose mailbox holds `ids`, recording which message bodies were fetched:
 * a message the cursor lists is skipped before its detail request is made.
 * `root` is what the engine would put in ctx.dataRoot; null leaves it out.
 */
function mailbox(ids, { dryRun = false, root = dataRoot } = {}) {
  const fetched = [];
  const logged = [];
  const ctx = {
    dryRun,
    ...(root ? { dataRoot: root } : {}),
    env: { GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' },
    settings: {},
    log: (line) => logged.push(String(line)),
    fetch: async (url) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fake' }) };
      if (url.includes('messages?')) return { ok: true, json: async () => ({ messages: ids.map((id) => ({ id })) }) };
      const id = ids.find((candidate) => url.includes(`messages/${candidate}?`));
      if (id) fetched.push(id);
      return {
        ok: true,
        json: async () => ({
          payload: {
            headers: [
              { name: 'Subject', value: 'Job alert' },
              { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=example.test' },
            ],
          },
        }),
      };
    },
  };
  return { ctx, fetched, logged };
}

const writeCursor = (dir, ids) => {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, STATE), JSON.stringify({ processed_message_ids: ids }));
};
const readCursor = (dir) => JSON.parse(readFileSync(join(dir, STATE), 'utf-8')).processed_message_ids;

test('the cursor is written under the data root, not the working directory', async () => {
  const { ctx } = mailbox(['m1']);
  await gmail.ingest(ctx);

  assert.deepEqual(readCursor(dataRoot), ['m1']);
  assert.equal(existsSync(join(workDir, 'data')), false, 'nothing may be created in the working directory');
});

test('a run from another directory resumes from the same cursor', async () => {
  await gmail.ingest(mailbox(['m1']).ctx);

  process.chdir(otherWorkDir);
  const second = mailbox(['m1', 'm2']);
  await gmail.ingest(second.ctx);

  assert.deepEqual(second.fetched, ['m2'], 'm1 was processed by the first run and must not be fetched again');
  assert.deepEqual(readCursor(dataRoot), ['m1', 'm2']);
  assert.equal(existsSync(join(otherWorkDir, 'data')), false);
});

test('a cursor left in the working directory by an earlier version is carried over', async () => {
  writeCursor(workDir, ['old-1', 'old-2']);
  const { ctx, fetched, logged } = mailbox(['old-1', 'old-2', 'new-1']);
  await gmail.ingest(ctx);

  assert.deepEqual(fetched, ['new-1'], 'messages the old cursor lists must not be ingested again');
  assert.deepEqual(readCursor(dataRoot), ['old-1', 'old-2', 'new-1']);
  assert.deepEqual(readCursor(workDir), ['old-1', 'old-2'], 'the old file is read, never rewritten or removed');
  assert.ok(
    logged.some((line) => line.includes(join(workDir, STATE)) && line.includes(join(dataRoot, STATE))),
    `the move is reported with both paths; logged: ${JSON.stringify(logged)}`,
  );
});

test('once the data root has a cursor, one in the working directory is ignored', async () => {
  writeCursor(dataRoot, ['m1']);
  writeCursor(workDir, ['m2']);
  const { ctx, fetched, logged } = mailbox(['m1', 'm2']);
  await gmail.ingest(ctx);

  assert.deepEqual(fetched, ['m2']);
  assert.deepEqual(readCursor(dataRoot), ['m1', 'm2']);
  assert.deepEqual(logged.filter((line) => line.includes(STATE)), []);
});

test('a dry run reads the carried-over cursor and writes nothing', async () => {
  writeCursor(workDir, ['old-1']);
  const { ctx, fetched } = mailbox(['old-1', 'new-1'], { dryRun: true });
  await gmail.ingest(ctx);

  assert.deepEqual(fetched, ['new-1']);
  assert.equal(existsSync(join(dataRoot, 'data')), false);
  assert.deepEqual(readCursor(workDir), ['old-1']);
});

test('a ctx with no dataRoot keeps the cursor in the working directory, as before', async () => {
  // An engine older than the capability builds a ctx without it. The plugin
  // must behave there exactly as it did, and say nothing about a move.
  writeCursor(workDir, ['m1']);
  const { ctx, fetched, logged } = mailbox(['m1', 'm2'], { root: null });
  await gmail.ingest(ctx);

  assert.deepEqual(fetched, ['m2']);
  assert.deepEqual(readCursor(workDir), ['m1', 'm2']);
  assert.equal(existsSync(join(dataRoot, 'data')), false);
  assert.deepEqual(logged.filter((line) => line.includes(STATE)), []);
});
