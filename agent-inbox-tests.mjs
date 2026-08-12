#!/usr/bin/env node

/**
 * agent-inbox-tests.mjs — regression tests for agent-inbox.mjs.
 *
 * Locks in the queue's behaviour:
 *   1. A first `add` seeds the header + agent protocol and one pending item.
 *   2. `add` is append-only and multiline text collapses to a single bullet.
 *   3. `list` shows pending only; `list --all` shows resolved items too.
 *   4. `resolve N` ticks the N-th item and appends a one-line result.
 *   5. An empty `add` fails loudly (exit 1) rather than queuing a blank line.
 *   6. On the default path, a first `add` self-heals .gitignore (idempotent) so
 *      the personal queue isn't accidentally tracked.
 *   7. Concurrent `add` calls all survive — the queue is appended to, never
 *      rewritten, so simultaneous writers cannot clobber each other.
 *   8. Item numbers are stable file positions: a batch of resolves read off ONE
 *      `list` all land on the item they named. (Numbering against the pending
 *      view instead shifted every higher number down per resolve, silently
 *      stamping results onto the wrong items.)
 *   9. Re-resolving an already-done item fails loudly instead of re-stamping.
 *  10. `--expect` aborts when the target doesn't contain the substring, and a
 *      valueless `--expect` fails rather than silently disabling the guard.
 *
 * Provisions a throwaway queue via CAREER_OPS_INBOX and a temp CWD; never
 * touches real user data.
 */

import { execFileSync, spawn } from 'child_process';
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

// Run a command expected to fail; returns { status, stderr }.
function runFail(inbox, args) {
  try {
    run(inbox, args);
    return { status: 0, stderr: '' };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr || '') };
  }
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

// ---------------------------------------------------------------------------
console.log('7. concurrent adds do not lose items (append, not rewrite)');
{
  // The queue's whole point is that anything — a dashboard, a script, cron —
  // can drop a request in without a session running, so simultaneous adds are
  // the expected case, not an exotic one. A read-whole-file/write-whole-file
  // cycle silently dropped every item that landed between the read and the
  // write: 30 concurrent adds kept 15.
  const dir = tmp('inbox-concurrent-');
  const inbox = join(dir, 'agent-inbox.md');
  const N = 30;
  // spawn(), not spawnSync() — a synchronous loop would serialize the adds and
  // pass even against the buggy rewrite, proving nothing.
  const exits = await Promise.all(
    Array.from({ length: N }, (_, i) => new Promise((res) => {
      const p = spawn(NODE, [CLI, 'add', `item-${i}`], {
        cwd: dir, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      p.on('exit', (code) => res(code));
    })),
  );
  const failedSpawn = exits.filter((c) => c !== 0).length;
  check('every concurrent add exited cleanly', failedSpawn === 0, `${failedSpawn} non-zero exits`);
  const body = readFileSync(inbox, 'utf8');
  const pending = body.split('\n').filter((l) => l.startsWith('- [ ]'));
  const kept = pending.length;
  check(`all ${N} concurrently queued items survive`, kept === N, `kept=${kept} of ${N}`);
  const actual = new Set(pending.map((l) => l.slice(l.indexOf('— ') + 2)));
  const expected = new Set(Array.from({ length: N }, (_, i) => `item-${i}`));
  const complete = actual.size === expected.size && [...expected].every((item) => actual.has(item));
  check('no item is duplicated or truncated', complete, `actual=${[...actual].join(', ')}`);
}

// ---------------------------------------------------------------------------
console.log('8. numbers are stable: a batch of resolves off ONE list stays correct');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  ['alpha', 'bravo', 'charlie', 'delta', 'echo'].forEach((t) => run(inbox, ['add', t]));

  // Snapshot the numbering once, exactly as an agent draining the queue would.
  const listed = run(inbox, ['list']);
  const numberOf = (text) => {
    const m = new RegExp(`^\\s*(\\d+)\\. \\[ \\] .*${text}`, 'm').exec(listed);
    return m ? Number(m[1]) : -1;
  };
  check('list numbers items 1..5 in file order',
    [1, 2, 3, 4, 5].every((n, i) => numberOf(['alpha', 'bravo', 'charlie', 'delta', 'echo'][i]) === n), listed.trim());

  // Fire the whole batch against that one snapshot — no re-listing between.
  run(inbox, ['resolve', String(numberOf('bravo')), '--result', 'R-bravo']);
  run(inbox, ['resolve', String(numberOf('charlie')), '--result', 'R-charlie']);
  run(inbox, ['resolve', String(numberOf('delta')), '--result', 'R-delta']);
  run(inbox, ['resolve', String(numberOf('echo')), '--result', 'R-echo']);

  const md = readFileSync(inbox, 'utf8');
  ['bravo', 'charlie', 'delta', 'echo'].forEach((t) => {
    check(`${t} carries its own result`, new RegExp(`^- \\[x\\] .*${t} → result: R-${t}$`, 'm').test(md), md);
  });
  check('alpha untouched and still pending', /^- \[ \] .*alpha$/m.test(md), md);

  const after = run(inbox, ['list']);
  check('surviving item keeps its original number (1)', /^\s*1\. \[ \] .*alpha/m.test(after), after.trim());
  check('list explains the hidden/resolved items', /resolved item\(s\) hidden/.test(after), after.trim());
}
// ---------------------------------------------------------------------------
console.log('9. re-resolving a done item fails loudly instead of re-stamping');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'foxtrot']);
  run(inbox, ['resolve', '1', '--result', 'first']);
  const { status, stderr } = runFail(inbox, ['resolve', '1', '--result', 'second']);
  check('non-zero exit on already-resolved item', status === 1, `exit=${status}`);
  check('error says why', /already resolved/.test(stderr), stderr.trim());
  const md = readFileSync(inbox, 'utf8');
  check('original result preserved', md.includes('→ result: first') && !md.includes('second'), md);
}
// ---------------------------------------------------------------------------
console.log('10. --expect guards the target');
{
  const inbox = join(tmp('inbox-'), 'agent-inbox.md');
  run(inbox, ['add', 'inquire at Dana-Farber']);
  run(inbox, ['add', 'apply at Change.org']);

  const wrong = runFail(inbox, ['resolve', '2', '--expect', 'Dana-Farber', '--result', 'oops']);
  check('mismatched --expect exits 1', wrong.status === 1, `exit=${wrong.status}`);
  check('error shows the actual item', /Change\.org/.test(wrong.stderr), wrong.stderr.trim());
  check('nothing written on mismatch', !readFileSync(inbox, 'utf8').includes('oops'));

  const bare = runFail(inbox, ['resolve', '2', '--expect', '--result', 'oops']);
  check('valueless --expect exits 1 (guard never silently disabled)', bare.status === 1, `exit=${bare.status}`);
  check('still nothing written', !readFileSync(inbox, 'utf8').includes('oops'));

  run(inbox, ['resolve', '2', '--expect', 'change.org', '--result', 'ok']);
  check('matching --expect (case-insensitive) resolves', /^- \[x\] .*Change\.org → result: ok$/m.test(readFileSync(inbox, 'utf8')));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
