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
 * Item numbers are *file positions*, not positions in the pending list: `add`
 * only ever appends, so a number never changes meaning once printed. `list`
 * therefore shows gaps as items get resolved (2, 4, 5) — the gaps are the
 * receipt that something was already handled, and a whole batch of resolves can
 * be read off a single `list` without drifting.
 *
 * Usage:
 *   node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
 *   node agent-inbox.mjs list [--all]                 # pending only, or every item
 *   node agent-inbox.mjs resolve 1 [--expect "Acme"] [--result "scored 4.3 — report 012"]
 */

import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync,
  openSync, fstatSync, readSync, closeSync,
} from 'fs';
import { dirname } from 'path';

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

// Parse the checklist into items, in file order. `num` is the stable 1-based
// item number used by `list` and `resolve` — it is the position in the FULL
// list, so resolving an item never renumbers the others.
function parseItems() {
  if (!existsSync(PATH)) return [];
  const items = [];
  readFileSync(PATH, 'utf8').split('\n').forEach((line, i) => {
    const m = /^- \[([ xX])\]\s*(.*)$/.exec(line.trim());
    if (m) items.push({ num: items.length + 1, line: i, done: m[1].toLowerCase() === 'x', text: m[2] });
  });
  return items;
}

function opt(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

function hasOpt(name) {
  return process.argv.includes('--' + name);
}

function add() {
  const text = oneLine(process.argv.slice(3).join(' '));
  if (!text) fail('add needs a request, e.g. node agent-inbox.mjs add "evaluate https://..."');
  ensureFile();
  // Append rather than rewrite. This is the queue's concurrent path — anything
  // running in the background can drop an item in — and a read-whole-file /
  // write-whole-file cycle loses every request that lands between the two. With
  // 30 concurrent `add` calls, half the queue vanished silently.
  //
  // POSIX guarantees an O_APPEND write is atomic below PIPE_BUF, and one
  // checklist line is far under it, so concurrent appends interleave instead of
  // clobbering. Checking the last byte first only decides whether a separating
  // newline is needed (for a file someone hand-edited without one); the write
  // itself is still a single atomic append.
  const separator = needsLeadingNewline(PATH) ? '\n' : '';
  appendFileSync(PATH, `${separator}- [ ] ${stamp()} — ${text}\n`);
  process.stdout.write(`Queued: ${text}\n`);
}

function list() {
  const all = process.argv.includes('--all');
  const parsed = parseItems();
  const items = parsed.filter((it) => all || !it.done);
  if (!items.length) return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  items.forEach((it) => {
    process.stdout.write(`${String(it.num).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.text}\n`);
  });
  // Explain the gaps rather than let them read as a display bug.
  if (items.length < parsed.length) {
    process.stdout.write(
      `\n(${parsed.length - items.length} resolved item(s) hidden — numbers are stable file positions, so gaps are expected. \`list --all\` shows everything.)\n`,
    );
  }
}

function resolve() {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) fail('resolve needs a 1-based item number (see `list`)');
  // Number against the FULL item list, not the pending subset. `add` only ever
  // appends, so an item's position is stable for the life of the file and a
  // batch of resolves read off one `list` stays correct. Numbering against the
  // pending view instead made each resolve shift every higher number down by
  // one — silently stamping later results onto the wrong items.
  const items = parseItems();
  const target = items[n - 1];
  if (!target) {
    const pending = items.filter((it) => !it.done).length;
    fail(`no item #${n} — inbox has ${items.length} item(s), ${pending} pending. Run \`list --all\`.`);
  }
  // Already-resolved is an error, not a silent re-stamp: it is what a stale
  // number from an older `list` most often lands on.
  if (target.done) fail(`item #${n} is already resolved — refusing to overwrite it:\n  #${n}: ${target.text}`);
  // Optional caller-side guard: abort unless the target says what the caller
  // thinks it says. Catches "right command, wrong target" generally.
  if (hasOpt('expect')) {
    const expect = opt('expect');
    if (!expect) fail('--expect needs a substring, e.g. --expect "Dana-Farber"');
    if (!target.text.toLowerCase().includes(expect.toLowerCase())) {
      fail(`item #${n} does not contain --expect ${JSON.stringify(expect)} — refusing to resolve:\n  #${n}: ${target.text}`);
    }
  }
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
if (cmd === 'add') add();
else if (cmd === 'list') list();
else if (cmd === 'resolve') resolve();
else {
  process.stdout.write(
    'Usage:\n' +
    '  node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"\n' +
    '  node agent-inbox.mjs list [--all]\n' +
    '  node agent-inbox.mjs resolve <n> [--expect "substring"] [--result "..."]\n' +
    '\n' +
    'Numbers are stable file positions: `list` shows gaps once items are\n' +
    'resolved, and a batch of resolves read off one `list` stays correct.\n' +
    '--expect aborts unless the target item contains that substring.\n',
  );
}
