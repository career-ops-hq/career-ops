import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanMessages, conversationTitle, MAX_CHAT_BYTES } from './assistant-history.mjs';

export class ChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function chatPath(root, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new ChatError('Invalid conversation id');
  return join(root, '.career-ops-web', 'chats', `${id}.json`);
}
export function readChat(root, id) {
  const file = chatPath(root, id);
  let raw;
  try { raw = readFileSync(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  try {
    const chat = JSON.parse(raw);
    if (chat.id !== id || chat.version !== 1 || !Number.isSafeInteger(chat.revision) || chat.revision < 1 || typeof chat.title !== 'string' || typeof chat.updatedAt !== 'string') throw new Error('Invalid document');
    return { ...chat, messages: cleanMessages(chat.messages) };
  } catch { throw new ChatError(`Conversation ${id} is damaged; its file was not changed`, 409); }
}
export function listChats(root) {
  let files;
  try { files = readdirSync(join(root, '.career-ops-web', 'chats')); }
  catch (err) { if (err.code === 'ENOENT') return { chats: [], errors: [] }; throw err; }
  const chats = [], errors = [];
  for (const file of files.filter(f => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(f))) {
    const id = file.slice(0, -5);
    try {
      const chat = readChat(root, id);
      if (chat) {
        const { messages, ...summary } = chat;
        chats.push(summary);
      }
    } catch (err) {
      // Isolate damaged documents, but do not disguise filesystem failures.
      if (!(err instanceof ChatError)) throw err;
      errors.push({ id, error: err.message });
    }
  }
  return { chats: chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), errors };
}
function withLock(root, id, operation) {
  const file = chatPath(root, id);
  mkdirSync(join(root, '.career-ops-web', 'chats'), { recursive: true });
  let fd;
  try { fd = openSync(`${file}.lock`, 'wx', 0o600); }
  catch (err) { if (err.code === 'EEXIST') throw new ChatError('Conversation is busy; retry saving', 409); throw err; }
  try { return operation(file); }
  finally { closeSync(fd); unlinkSync(`${file}.lock`); }
}
export function saveChat(root, id, input) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new ChatError('Conversation revision required');
  let messages;
  try { messages = cleanMessages(input.messages); } catch (err) { throw new ChatError(err.message); }
  if (!messages.some(m => m.role === 'user')) throw new ChatError('Empty conversations are not saved');
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100)) throw new ChatError('Title must contain 1–100 characters');
  if (Buffer.byteLength(JSON.stringify(messages)) > MAX_CHAT_BYTES) throw new ChatError('Conversation is too large to save', 413);
  return withLock(root, id, file => {
    const prior = readChat(root, id);
    if (input.revision === 0 && prior && JSON.stringify(prior.messages) === JSON.stringify(messages) && (!input.title || input.title.trim() === prior.title)) return prior;
    if ((prior?.revision ?? 0) !== input.revision) throw new ChatError('Conversation changed in another tab. Reload before editing; your unsaved text is still visible.', 409);
    const chat = { version: 1, id, revision: input.revision + 1, title: input.title?.trim() || prior?.title || conversationTitle(messages), updatedAt: new Date().toISOString(), messages };
    const temp = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(chat), { mode: 0o600, flag: 'wx' }); renameSync(temp, file); }
    finally { try { unlinkSync(temp); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
    return chat;
  });
}
export function deleteChat(root, id, revision) {
  return withLock(root, id, file => {
    const prior = readChat(root, id);
    if (!prior) return;
    if (prior.revision !== revision) throw new ChatError('Conversation changed in another tab; reload before deleting', 409);
    unlinkSync(file);
  });
}
