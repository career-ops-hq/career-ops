#!/usr/bin/env node

/**
 * tests/agent-inbox-supersede.test.mjs: `agent-inbox.mjs add --supersede <prefix>`.
 *
 * A scheduled job that queues the same recurring alert on every run leaves one
 * pending item per run, so the agent drains a long pile of identical lines at
 * the start of a session. `--supersede <prefix>` resolves the still-pending
 * items whose request starts with the prefix before the new one is appended, so
 * the queue holds one current alert.
 *
 * Provisions a throwaway queue via CAREER_OPS_INBOX; never touches real user data.
 * Run: node test-all.mjs --only agent-inbox-supersede
 */

import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

console.log('\nagent-inbox.mjs: add --supersede');
const NODE = process.execPath;
const CLI = join(ROOT, 'agent-inbox.mjs');

function check(name, cond, detail = '') {
  if (cond) pass(name);
  else fail(`${name}${detail ? `: ${detail}` : ''}`);
}

function run(inbox, args) {
  return execFileSync(NODE, [CLI, ...args], {
    cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runFail(inbox, args) {
  try {
    run(inbox, args);
    return { status: 0, stderr: '' };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr) };
  }
}

const newInbox = () => join(mkdtempSync(join(tmpdir(), 'inbox-supersede-')), 'agent-inbox.md');
const pending = (md) => md.split('\n').filter((l) => /^- \[ \]/.test(l));
const done = (md) => md.split('\n').filter((l) => /^- \[x\]/.test(l));

console.log('1. without the flag, repeated alerts pile up (the baseline)');
{
  const inbox = newInbox();
  for (let i = 0; i < 3; i++) run(inbox, ['add', 'follow-up alert: 5 overdue']);
  check('three plain adds leave three pending items', pending(readFileSync(inbox, 'utf8')).length === 3);
}

console.log('2. --supersede keeps one pending alert');
{
  const inbox = newInbox();
  for (let i = 1; i <= 4; i++) run(inbox, ['add', `follow-up alert: ${i} overdue`, '--supersede', 'follow-up alert:']);
  const md = readFileSync(inbox, 'utf8');
  check('one pending item remains', pending(md).length === 1, md);
  check('the pending item is the newest', /follow-up alert: 4 overdue$/.test(pending(md)[0] ?? ''), md);
  check('the older three are resolved', done(md).length === 3, md);
  check('each resolved item says why', done(md).every((l) => /→ result: superseded by a newer item/.test(l)), md);
  check('the flag is not queued as part of the request text', !md.includes('--supersede'), md);
}

console.log('3. only pending items that start with the prefix are touched');
{
  const inbox = newInbox();
  run(inbox, ['add', 'evaluate https://example.com/jobs/1']);
  run(inbox, ['add', 'follow-up alert: old']);
  run(inbox, ['add', 'note: follow-up alert: quoted mid-sentence']);
  run(inbox, ['add', 'follow-up alert: already handled']);
  run(inbox, ['resolve', '4', '--result', 'handled by hand']);
  const out = run(inbox, ['add', 'follow-up alert: new', '--supersede', 'follow-up alert:']);
  const md = readFileSync(inbox, 'utf8');
  check('an unrelated item stays pending', /^- \[ \].*evaluate https:\/\/example\.com\/jobs\/1$/m.test(md), md);
  check('a prefix match in the middle of a request stays pending', /^- \[ \].*note: follow-up alert: quoted/m.test(md), md);
  check('the matching pending item is resolved', /^- \[x\].*follow-up alert: old → result: superseded/m.test(md), md);
  check('an already-resolved item keeps its own result', /follow-up alert: already handled → result: handled by hand$/m.test(md), md);
  check('the new item is appended last', /^- \[ \].*follow-up alert: new$/.test(md.trimEnd().split('\n').pop()), md);
  check('the output names what was superseded', /Superseded #2:/.test(out) && /Queued: follow-up alert: new/.test(out), out);
  check('item numbers stay stable file positions', /^- \[[ x]\].*follow-up alert: new$/m.test(md) && md.split('\n').filter((l) => /^- \[[ x]\]/.test(l)).length === 5, md);
}

console.log('4. no match, or a missing queue, behaves like a plain add');
{
  const inbox = newInbox();
  const out = run(inbox, ['add', 'first alert', '--supersede', 'alert:']);
  const md = readFileSync(inbox, 'utf8');
  check('a first add with --supersede creates the queue with one pending item', pending(md).length === 1 && /^# Agent Inbox/.test(md), md);
  check('nothing is reported as superseded', !/Superseded/.test(out), out);
}

console.log('5. --supersede needs a prefix');
{
  const inbox = newInbox();
  run(inbox, ['add', 'keep me']);
  const bare = runFail(inbox, ['add', 'new alert', '--supersede']);
  check('a bare --supersede exits 1', bare.status === 1, `status=${bare.status}`);
  check('the error says what to pass', /--supersede needs a prefix/.test(bare.stderr), bare.stderr);
  const blank = runFail(inbox, ['add', 'new alert', '--supersede', '   ']);
  check('a blank prefix exits 1', blank.status === 1, `status=${blank.status}`);
  const md = readFileSync(inbox, 'utf8');
  check('a refused add changes nothing', pending(md).length === 1 && /keep me/.test(md) && !/new alert/.test(md), md);
  const noText = runFail(inbox, ['add', '--supersede', 'alert:']);
  check('--supersede with no request text still fails', noText.status === 1, `status=${noText.status}`);
}

console.log('6. the rewrite holds the queue lock and loses nothing');
{
  const inbox = newInbox();
  writeFileSync(inbox, '# Agent Inbox\n\n- [ ] 2026-01-01 00:00 — digest: old\n');
  const held = await acquirePipelineLock(inbox, { timeoutMs: 10_000 });
  const child = spawn(NODE, [CLI, 'add', 'digest: new', '--supersede', 'digest:'], {
    cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise((res) => child.on('close', (code) => res(code)));
  const whileHeld = await Promise.race([
    closed.then(() => 'closed'),
    new Promise((res) => setTimeout(() => res('waiting'), 500)),
  ]);
  check('supersede stays blocked while another writer owns the lock', whileHeld === 'waiting', `state=${whileHeld}`);
  held.release();
  check('supersede exits cleanly once the lock is released', (await closed) === 0);
  const md = readFileSync(inbox, 'utf8');
  check('the old item is resolved and the new one pending', pending(md).length === 1 && done(md).length === 1, md);
}

console.log('7. concurrent superseding adds neither lose an item nor leave two pending');
{
  const inbox = newInbox();
  run(inbox, ['add', 'unrelated request']);
  const writers = Array.from({ length: 12 }, (_, i) => new Promise((res) => {
    const c = spawn(NODE, [CLI, 'add', `digest: run ${i}`, '--supersede', 'digest:'], {
      cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    c.on('close', (code) => res(code));
  }));
  const codes = await Promise.all(writers);
  const md = readFileSync(inbox, 'utf8');
  check('every writer exits 0', codes.every((c) => c === 0), codes.join(','));
  check('exactly one digest is pending', pending(md).filter((l) => /digest:/.test(l)).length === 1, md);
  check('every digest run is on file, 1 pending + 11 resolved', md.split('\n').filter((l) => /digest: run/.test(l)).length === 12, md);
  check('the unrelated request is untouched', /^- \[ \].*unrelated request$/m.test(md), md);
  check('no temp file is left behind', readdirSync(join(inbox, '..')).every((f) => !f.endsWith('.tmp')));
}
