#!/usr/bin/env node

/**
 * agent-inbox.mjs — a tiny bridge between *looking at* the pipeline and
 * *acting on* it.
 *
 * career-ops is driven from an AI session, but there's no durable place to drop
 * a request when you're not in one — e.g. while glancing at the tracker (or a
 * dashboard) you think "evaluate this URL" or "draft a follow-up for #7". This
 * is that place: an append-only queue the agent drains at the start of a
 * session.
 *
 *   data/agent-inbox.md
 *     - [ ] <stamp> — <request>          (pending)
 *     - [x] <stamp> — <request> → result: <one line>   (resolved)
 *
 * Fully local-first and human-in-the-loop: nothing here auto-submits. Queued
 * items are *intents* for the agent to action and the user to review. Markdown
 * checklist, no database, no server, no dependencies — edit it by hand or via
 * this CLI, and any tool (a dashboard, a script, cron) can append to it. The
 * protocol an agent follows is documented in modes/agent-inbox.md.
 *
 * Usage:
 *   node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
 *   node agent-inbox.mjs list [--all]                 # pending only, or every item
 *   node agent-inbox.mjs resolve 1 [--result "scored 4.3 — report 012"]
 */

import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync,
  openSync, fstatSync, readSync, closeSync,
} from 'fs';
import { dirname } from 'path';
import { withPipelineLock } from './pipeline-lock.mjs';

const PATH = process.env.CAREER_OPS_INBOX || 'data/agent-inbox.md';

const HEADER = [
  '# Agent Inbox',
  '',
  '> **Agent protocol:** at the start of a career-ops session, read this file.',
  '> Run each unchecked item top-to-bottom. After each, mark it `[x]` and append',
  '> `→ result: <one line>`. Items that need live user input (a mock, a paste, a',
  '> decision) → ask the user to start them instead of running them.',
  '>',
  '> Nothing here auto-submits — queued items are *intents* for you to action and',
  '> the user to review. Appended by hand, by a dashboard, or by agent-inbox.mjs.',
  '',
].join('\n');

function stamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function ensureGitignored() {
  // The inbox is personal data. On installs whose .gitignore predates this
  // feature, make sure the default path is ignored so a first `add` can't
  // accidentally commit it. Only manages the default, non-overridden path.
  if (process.env.CAREER_OPS_INBOX || PATH !== 'data/agent-inbox.md') return;
  try {
    if (!existsSync('.gitignore')) return; // not a git checkout we should touch
    const text = readFileSync('.gitignore', 'utf8');
    if (text.split('\n').some((l) => l.trim() === PATH)) return; // already ignored
    writeFileSync('.gitignore', text.replace(/\s*$/, '') + `\n${PATH}\n`);
  } catch { /* best effort — never block queuing on this */ }
}

function oneLine(s) {
  // markdown-checklist-safe: collapse to a single bullet line
  return String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

// MUST be called with the queue lock held — see add(). Creating the file is
// only half of it; the file is not usable until the header is IN it, and that
// is two syscalls, not one.
function ensureFile() {
  if (existsSync(PATH)) return;
  ensureGitignored();
  mkdirSync(dirname(PATH), { recursive: true });
  // 'wx': atomic create-exclusive. Two concurrent first-time `add` calls can
  // both pass the existsSync check above before either writes; without an
  // exclusive flag, the second writeFileSync (default 'w', which truncates)
  // lands after the first has already appended its item and wipes it back to
  // just the header. 'wx' makes only one of them win the create — the loser
  // gets EEXIST and does nothing, same as if it had seen existsSync === true.
  //
  // 'wx' settles the two-creator case and nothing else. It makes the CREATE
  // atomic, not the INITIALISATION: writeFileSync is open() then write(), and
  // between those two syscalls the file EXISTS and is ZERO BYTES. Measured on
  // Windows, a second process polling existsSync and stat-ing the moment the
  // file appeared saw it at 0 bytes in 303 of 400 rounds.
  //
  // So there is a third participant the exclusive flag cannot see: a writer
  // that arrives INSIDE that window, finds existsSync === true, skips creation,
  // and appends — into a file this call is about to overwrite from offset 0.
  // Its item is gone, with no error anywhere; the write below simply lands on
  // top of it. That is why the caller holds the lock across this function
  // rather than around the append alone.
  try {
    writeFileSync(PATH, HEADER, { flag: 'wx' });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

// Whether appending to `path` needs a leading newline first, i.e. the file is
// non-empty and doesn't already end in one. Reads only the last byte instead
// of the whole file — the full-file read this replaced was only ever used to
// check one byte.
function needsLeadingNewline(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a; // '\n'
  } finally {
    closeSync(fd);
  }
}

// Parse the checklist into items, in file order.
function parseItems() {
  if (!existsSync(PATH)) return [];
  const items = [];
  readFileSync(PATH, 'utf8').split('\n').forEach((line, i) => {
    const m = /^- \[([ xX])\]\s*(.*)$/.exec(line.trim());
    if (m) items.push({ line: i, done: m[1].toLowerCase() === 'x', text: m[2] });
  });
  return items;
}

function opt(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

async function add() {
  const text = oneLine(process.argv.slice(3).join(' '));
  if (!text) fail('add needs a request, e.g. node agent-inbox.mjs add "evaluate https://..."');
  // Append rather than rewrite. This is the queue's concurrent path — anything
  // running in the background can drop an item in — and a read-whole-file /
  // write-whole-file cycle loses every request that lands between the two. With
  // 30 concurrent `add` calls, half the queue vanished silently.
  //
  // POSIX guarantees an O_APPEND write is atomic below PIPE_BUF, and one
  // checklist line is far under it, so concurrent appends interleave instead of
  // clobbering. WINDOWS IS NOT POSIX, and that is the whole reason for the lock
  // below: with 30 concurrent adds on windows-latest this dropped exactly one
  // item (#2777), silently, which is the same failure this function exists to
  // remove — it just moved to the one platform the guarantee does not cover.
  //
  // The lock is the repo's existing one rather than a second mechanism: the
  // same `withPipelineLock` that scan.mjs uses for scan-history appends. Two
  // lock implementations would drift, and the append is short enough that
  // serializing it costs nothing next to spawning the process that calls it.
  //
  // Checking the last byte still happens INSIDE the lock: it decides whether a
  // separating newline is needed, and reading it outside would race with
  // another writer's append between the check and the write.
  //
  // timeoutMs is raised from the shared 8s default because this queue's whole
  // point is bursty concurrent writers (a dashboard, a script, cron all drop
  // items at once), and lock acquisition is a retry lottery, not a fair queue.
  // Serving N herded waiters is the coupon-collector problem: ~N·H(N) rounds,
  // so 30 concurrent adds need ~120 rounds while 8000/80 = 100 only affords
  // ~100. On the slow, contended windows-latest runner that shortfall makes one
  // waiter time out and its item is LOST, the exact #2777 drop, reappearing as
  // a loud LockTimeoutError instead of a silent overwrite. Jitter in
  // pipeline-lock.mjs cuts the collision rate ~6x but is explicitly "not a
  // cure"; the fit-for-purpose budget for a burst-write queue is the contained
  // fix. 30s gives ~375 rounds of headroom, well past the herd's worst case,
  // while the critical section itself is a single sub-millisecond append.
  //
  // ensureFile() is INSIDE the lock, not before it. Seeding the file is a
  // check-create-initialise sequence, and run unlocked it loses items the same
  // way the unlocked append did: a writer that observes the file between the
  // creator's open() and its write() sees a zero-byte file, appends into it,
  // and has its line overwritten when the header lands at offset 0. Every
  // writer exits 0 and the queue is left perfectly well-formed, one item
  // shorter — the silent drop the lock was added to end, one step earlier in
  // the same function.
  //
  // Holding the lock across the seed makes the window unreachable rather than
  // narrow: no writer can observe the file until the creator has released, and
  // the creator writes the header before it releases. 'wx' above stays as the
  // guard against writers that are not this function.
  await withPipelineLock(PATH, () => {
    ensureFile();
    const separator = needsLeadingNewline(PATH) ? '\n' : '';
    appendFileSync(PATH, `${separator}- [ ] ${stamp()} — ${text}\n`);
  }, { timeoutMs: 30_000 });
  process.stdout.write(`Queued: ${text}\n`);
}

function list() {
  const all = process.argv.includes('--all');
  const items = parseItems().filter((it) => all || !it.done);
  if (!items.length) return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  items.forEach((it, n) => {
    process.stdout.write(`${String(n + 1).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.text}\n`);
  });
}

function resolve() {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) fail('resolve needs a 1-based item number (see `list`)');
  // Number against the pending view, so `list` then `resolve N` line up.
  const pending = parseItems().filter((it) => !it.done);
  const target = pending[n - 1];
  if (!target) fail(`no pending item #${n} (${pending.length} pending)`);
  const result = oneLine(opt('result'));
  const lines = readFileSync(PATH, 'utf8').split('\n');
  let updated = lines[target.line].replace('[ ]', '[x]');
  if (result && !/→ result:/.test(updated)) updated += ` → result: ${result}`;
  lines[target.line] = updated;
  writeFileSync(PATH, lines.join('\n'));
  process.stdout.write(`Resolved #${n}: ${target.text}\n`);
}

function fail(msg) {
  process.stderr.write(`agent-inbox.mjs: ${msg}\n`);
  process.exit(1);
}

const cmd = process.argv[2];
if (cmd === 'add') await add();
else if (cmd === 'list') list();
else if (cmd === 'resolve') resolve();
else {
  process.stdout.write(
    'Usage:\n' +
    '  node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"\n' +
    '  node agent-inbox.mjs list [--all]\n' +
    '  node agent-inbox.mjs resolve <n> [--result "..."]\n',
  );
}
