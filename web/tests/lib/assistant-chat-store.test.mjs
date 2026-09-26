import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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
  writeFileSync(join(root, '.career-ops-web', 'chats', `${id}.json.lock`), '');
  assert.throws(() => saveChat(root, id, { revision: 1, messages }), /busy/);
  assert.equal(readChat(root, id).revision, 1);
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
