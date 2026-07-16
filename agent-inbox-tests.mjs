#!/usr/bin/env node

/**
 * agent-inbox-tests.mjs — regression tests for agent-inbox.mjs.
 *
 * Locks in the queue's behaviour:
 *   1. A first `add` seeds the header + agent protocol and one pending item.
 *   2. `add` is append-only and multiline text collapses to a single bullet.
 *   3. `list` shows pending only; `list --all` shows resolved items too.
 *   4. `resolve N` ticks the N-th *pending* item and appends a one-line result,
 *      so `list` then `resolve N` line up.
 *   5. An empty `add` fails loudly (exit 1) rather than queuing a blank line.
 *   6. On the default path, a first `add` self-heals .gitignore (idempotent) so
 *      the personal queue isn't accidentally tracked.
 *
 * Provisions a throwaway queue via CAREER_OPS_INBOX and a temp CWD; never
 * touches real user data.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CLI = join(ROOT, 'agent-inbox.mjs');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Run agent-inbox.mjs against a provisioned queue file; returns stdout.
function run(inbox, args, opts = {}) {
  return execFileSync(NODE, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_INBOX: inbox },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

// ---------------------------------------------------------------------------
console.log('1. First add seeds header + protocol and one pending item');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'evaluate https://acme.com/jobs/42']);
  const md = readFileSync(inbox, 'utf8');
  check('header present', /^# Agent Inbox/.test(md));
  check('agent protocol documented', /Agent protocol:/.test(md));
  check('nothing auto-submits is stated', /auto-submit/.test(md));
  check('one pending checklist item', (md.match(/^- \[ \]/gm) || []).length === 1, md);
  check('request text preserved', md.includes('evaluate https://acme.com/jobs/42'));
}

// ---------------------------------------------------------------------------
console.log('2. add is append-only; multiline text collapses to one bullet');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'first request']);
  run(inbox, ['add', 'second\nrequest with newline']);
  const md = readFileSync(inbox, 'utf8');
  check('two pending items', (md.match(/^- \[ \]/gm) || []).length === 2);
  check('first item retained', md.includes('first request'));
  check('newline collapsed (no mid-item break)', md.includes('second request with newline'));
  check('item count == bullet count (no stray bullets)', (md.match(/^- \[/gm) || []).length === 2);
}

// ---------------------------------------------------------------------------
console.log('3. list shows pending; --all includes resolved');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'alpha']);
  run(inbox, ['add', 'beta']);
  run(inbox, ['resolve', '1', '--result', 'done alpha']);
  const pending = run(inbox, ['list']);
  const all = run(inbox, ['list', '--all']);
  check('pending list hides resolved alpha', !pending.includes('alpha') && pending.includes('beta'), pending.trim());
  check('--all shows both', all.includes('alpha') && all.includes('beta'));
}

// ---------------------------------------------------------------------------
console.log('4. resolve ticks the N-th pending item + appends a one-line result');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'gamma']);
  run(inbox, ['resolve', '1', '--result', 'scored 4.3 — report 012']);
  const md = readFileSync(inbox, 'utf8');
  check('item marked done', /^- \[x\] .*gamma/m.test(md), md);
  check('result appended', /→ result: scored 4\.3 — report 012/.test(md));
  check('no pending left', (md.match(/^- \[ \]/gm) || []).length === 0);
}

// ---------------------------------------------------------------------------
console.log('5. empty add fails (exit 1), does not queue a blank line');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  let exit = 0;
  try { run(inbox, ['add', '   ']); } catch (e) { exit = e.status; }
  check('non-zero exit on empty request', exit === 1, `exit=${exit}`);
}

// ---------------------------------------------------------------------------
console.log('6. first add on the default path self-heals .gitignore (idempotent)');
{
  const repo = tmp('inbox-repo-');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\noutput/*\n');
  const addOnce = () => execFileSync(NODE, [CLI, 'add', 'queue a scan'], {
    cwd: repo, env: { ...process.env, CAREER_OPS_INBOX: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  addOnce(); addOnce();
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  const ruleCount = gi.split('\n').filter((l) => l.trim() === 'data/agent-inbox.md').length;
  check('.gitignore gains exactly one data/agent-inbox.md rule', ruleCount === 1, `count=${ruleCount}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
