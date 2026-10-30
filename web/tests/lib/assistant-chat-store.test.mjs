import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readChat, listChats, saveChat, deleteChat } from '../../src/lib/assistant-chat-store.mjs';
const messages = [{ role: 'user', parts: [{ type: 'text', text: 'My first conversation' }] }];
function fixture(t) { const root = mkdtempSync(join(tmpdir(), 'assistant-chats-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
test('disk conversations survive independent reads, rename, switching and delete', t => {
  const root = fixture(t), first = randomUUID(), second = randomUUID();
  assert.deepEqual(listChats(root), { chats: [], errors: [] });
  assert.equal(readChat(root, first), null);
  const a = saveChat(root, first, { revision: 0, messages });
  assert.equal(a.title, 'My first conversation');
  saveChat(root, second, { revision: 0, messages: [{ role: 'user', content: 'Second chat' }] });
  assert.equal(listChats(root).chats.length, 2);
  const renamed = saveChat(root, first, { revision: 1, messages, title: 'Career plans' });
  assert.equal(renamed.revision, 2);
  assert.deepEqual(readChat(root, first).messages, messages);
  assert.equal(readChat(root, first).title, 'Career plans');
  deleteChat(root, first, 2);
  assert.equal(readChat(root, first), null);
  assert.equal(listChats(root).chats.length, 1);
});
test('stale tabs and deletes cannot overwrite newer messages', t => {
  const root = fixture(t), id = randomUUID();
  saveChat(root, id, { revision: 0, messages });
  const next = [...messages, { role: 'assistant', content: 'New response' }];
  saveChat(root, id, { revision: 1, messages: next });
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /another tab/);
  assert.throws(() => deleteChat(root, id, 1), /another tab/);
  assert.equal(readChat(root, id).messages.length, 2);
});
test('migration retries do not duplicate a conversation or increment its revision', t => {
  const root = fixture(t), id = randomUUID();
  const first = saveChat(root, id, { revision: 0, messages });
  assert.deepEqual(saveChat(root, id, { revision: 0, messages }), first);
  assert.equal(listChats(root).chats.length, 1);
});
test('invalid ids, empty chats, oversized payloads, and corrupt files never overwrite data', t => {
  const root = fixture(t), id = randomUUID();
  assert.throws(() => saveChat(root, '../outside', { revision: 0, messages }), /Invalid conversation id/);
  assert.throws(() => saveChat(root, id, { revision: 0, messages: [] }), /Empty/);
  assert.throws(() => saveChat(root, id, { revision: 0, messages: [{ role: 'user', content: 'x'.repeat(1_000_001) }] }), /too large/);
  saveChat(root, id, { revision: 0, messages });
  const path = join(root, '.career-ops-web', 'chats', `${id}.json`);
  writeFileSync(path, '{broken');
  assert.throws(() => readChat(root, id), /damaged/);
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /damaged/);
  assert.deepEqual(listChats(root).chats, []);
  assert.match(listChats(root).errors[0].error, /damaged/);
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  assert.deepEqual(readdirSync(join(root, '.career-ops-web', 'chats')), [`${id}.json`]);
});
test('an in-progress writer is reported rather than bypassed', t => {
  const root = fixture(t), id = randomUUID();
  saveChat(root, id, { revision: 0, messages });
  // A live holder: another live process, so the lock is never judged stale,
  // however old. Not this process's pid: a stamp of ours with no handle behind
  // it is aged out (#5390), so it would pass here only while young. Backdated a
  // day, so "busy" can only come from the liveness rule.
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
  t.after(() => holder.kill());
  const lockDir = join(root, '.career-ops-web', 'chats', `${id}.json.lock`);
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: holder.pid, token: 'peer', started_at: new Date().toISOString() }));
  const dayAgo = new Date(Date.now() - 86_400_000);
  utimesSync(lockDir, dayAgo, dayAgo);
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /busy/);
  assert.throws(() => deleteChat(root, id, 1), /busy/);
  assert.equal(readChat(root, id).revision, 1);
  assert.ok(existsSync(join(lockDir, 'owner.json')), 'a live holder keeps its lock');
});
test('a lock left by a crashed save is reclaimed instead of blocking the conversation for ever', t => {
  const root = fixture(t), id = randomUUID();
  saveChat(root, id, { revision: 0, messages });
  const lockDir = join(root, '.career-ops-web', 'chats', `${id}.json.lock`);
  const exited = spawnSync(process.execPath, ['-e', '']);
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: exited.pid, token: 'crashed', started_at: new Date().toISOString() }));
  assert.equal(saveChat(root, id, { revision: 1, messages }).revision, 2);
  assert.equal(existsSync(lockDir), false);
});
// The previous version locked with an O_EXCL FILE at the same path the lock
// directory now uses, and never recovered it. A file left by a crash must not
// wedge the conversation after an upgrade; a fresh one may still be a save in
// flight in an old process, so it is left alone until it ages out.
test('a lock file left by the previous version is reclaimed once old, and respected while fresh', t => {
  const root = fixture(t), id = randomUUID();
  saveChat(root, id, { revision: 0, messages });
  const lockPath = join(root, '.career-ops-web', 'chats', `${id}.json.lock`);
  writeFileSync(lockPath, '');
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /busy/);
  const dayAgo = new Date(Date.now() - 86_400_000);
  utimesSync(lockPath, dayAgo, dayAgo);
  assert.equal(saveChat(root, id, { revision: 1, messages }).revision, 2);
  assert.equal(existsSync(lockPath), false);
  assert.deepEqual(readdirSync(join(root, '.career-ops-web', 'chats')), [`${id}.json`]);
});

// A release whose rm is contended (Windows EBUSY) is swallowed by design, so the
// lock directory survives under the server's own live pid. That pid must not
// keep it busy until the server restarts: with no handle behind it, it ages
// out like any ownerless leftover (#5390 review).
test('a lock the server failed to release does not block the conversation until restart', t => {
  const root = fixture(t), id = randomUUID();
  const lockDir = join(root, '.career-ops-web', 'chats', `${id}.json.lock`);
  const originalRmSync = fs.rmSync;
  fs.rmSync = (path, ...args) => {
    if (String(path) === lockDir) throw Object.assign(new Error('simulated contended release'), { code: 'EBUSY' });
    return originalRmSync(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(saveChat(root, id, { revision: 0, messages }).revision, 1);
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.ok(existsSync(join(lockDir, 'owner.json')), 'the swallowed release left the lock behind');
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /busy/, 'a fresh leftover is respected');
  const dayAgo = new Date(Date.now() - 86_400_000);
  utimesSync(lockDir, dayAgo, dayAgo);
  assert.equal(saveChat(root, id, { revision: 1, messages }).revision, 2);
  assert.equal(existsSync(lockDir), false);
});

test('lock and temp cleanup errors do not replace a saved conversation', t => {
  const root = fixture(t), lockId = randomUUID(), tempId = randomUUID();
  const lockDir = join(root, '.career-ops-web', 'chats', `${lockId}.json.lock`);
  const originalRmSync = fs.rmSync, originalUnlinkSync = fs.unlinkSync, originalConsoleError = console.error;
  const logged = [];
  // A release whose removal fails for a reason other than Windows contention
  // (which the protocol swallows by design) is reported, never thrown over the
  // completed save.
  fs.rmSync = (path, ...args) => {
    if (String(path) === lockDir) throw Object.assign(new Error('simulated lock release failure'), { code: 'EIO' });
    return originalRmSync(path, ...args);
  };
  fs.unlinkSync = path => {
    if (String(path).endsWith('.tmp')) throw Object.assign(new Error('simulated temp unlink failure'), { code: 'EACCES' });
    return originalUnlinkSync(path);
  };
  console.error = (...args) => logged.push(args);
  syncBuiltinESMExports();
  try {
    assert.equal(saveChat(root, lockId, { revision: 0, messages }).revision, 1);
    assert.equal(readChat(root, lockId).revision, 1);
    assert.equal(saveChat(root, tempId, { revision: 0, messages }).revision, 1);
    assert.equal(readChat(root, tempId).revision, 1);
    assert.deepEqual(logged.map(([message]) => message), [
      'chat temp cleanup failed',
      `Warning: lock cleanup failed at ${lockDir}: simulated lock release failure`,
      'chat temp cleanup failed',
    ]);
  } finally {
    fs.rmSync = originalRmSync;
    fs.unlinkSync = originalUnlinkSync;
    console.error = originalConsoleError;
    syncBuiltinESMExports();
  }
});

test('one damaged conversation does not hide healthy conversations or prevent new saves', t => {
  const root = fixture(t), good = randomUUID(), bad = randomUUID(), next = randomUUID();
  saveChat(root, good, { revision: 0, messages });
  const path = join(root, '.career-ops-web', 'chats', `${bad}.json`);
  writeFileSync(path, '{broken');
  const result = listChats(root);
  assert.deepEqual(result.chats.map(c => c.id), [good]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, bad);
  assert.match(result.errors[0].error, /damaged/);
  saveChat(root, next, { revision: 0, messages });
  assert.equal(listChats(root).chats.length, 2);
  assert.equal(readFileSync(path, 'utf8'), '{broken');
});
test('over-limit drafts leave the saved conversation intact and permit a fresh conversation', t => {
  const root = fixture(t), id = randomUUID();
  const full = Array.from({ length: 2000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }));
  saveChat(root, id, { revision: 0, messages: full });
  const before = readFileSync(join(root, '.career-ops-web', 'chats', `${id}.json`), 'utf8');
  for (const draft of [[...full, ...messages], [{ role: 'user', content: 'x'.repeat(1_000_001) }]]) {
    assert.throws(() => saveChat(root, id, { revision: 1, messages: draft }));
    assert.equal(readFileSync(join(root, '.career-ops-web', 'chats', `${id}.json`), 'utf8'), before);
  }
  saveChat(root, randomUUID(), { revision: 0, messages });
  assert.equal(listChats(root).chats.length, 2);
});
