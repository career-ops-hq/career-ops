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
 *   7. Concurrent `add` calls all survive — the queue is appended to, never
 *      rewritten, so simultaneous writers cannot clobber each other.
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
  // Capture each child's stderr, and PRINT the losers' when the case fails.
  // Without this the only evidence a failure leaves is `kept=29 of 30`, which
  // names the symptom and hides the mechanism: a lock-acquisition timeout, a
  // Windows EPERM/EBUSY on the lock directory and a crash in the append all
  // look identical from out here. This case has failed on windows-latest
  // repeatedly, including after #2825 raised the acquisition budget to 30s,
  // and every one of those failures cost a round trip because the log said
  // what was lost and never why. A sub-millisecond append that cannot get the
  // lock inside 30 SECONDS is not simply a crowded queue, so the distinction
  // is the whole diagnosis.
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => new Promise((res) => {
      const p = spawn(NODE, [CLI, 'add', `item-${i}`], {
        cwd: dir, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', (chunk) => { err += chunk; });
      p.on('exit', (code) => res({ item: `item-${i}`, code, err }));
    })),
  );
  const exits = results.map((r) => r.code);
  const losers = results.filter((r) => r.code !== 0);
  const failedSpawn = losers.length;
  check('every concurrent add exited cleanly', failedSpawn === 0, `${failedSpawn} non-zero exits`);
  for (const l of losers) {
    // Node prints the offending SOURCE LINE before the error itself, so taking
    // the first lines verbatim buries the one fact worth having. Pull out the
    // `SomeError: message` line, which is what separates the hypotheses, and
    // keep a truncated tail as a fallback when nothing matches.
    const lines = l.err.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    const cause = lines.find((s) => /^[A-Za-z_$][\w$]*(Error|Exception):/.test(s))
      || lines.find((s) => /\b(EPERM|EBUSY|EACCES|ENOENT|EEXIST)\b/.test(s))
      || lines.slice(-1)[0]
      || '(no stderr)';
    // Generous, because the owner record pipeline-lock.mjs appends to a
    // LockTimeoutError is the diagnostic payload; truncating it away would
    // leave the same symptom-without-mechanism this instrumentation exists
    // to end.
    console.log(`      ↳ ${l.item} exited ${l.code}: ${cause.slice(0, 500)}`);
  }
  const body = readFileSync(inbox, 'utf8');
  const pending = body.split('\n').filter((l) => l.startsWith('- [ ]'));
  const kept = pending.length;
  check(`all ${N} concurrently queued items survive`, kept === N, `kept=${kept} of ${N}`);
  const actual = new Set(pending.map((l) => l.slice(l.indexOf('— ') + 2)));
  const expected = new Set(Array.from({ length: N }, (_, i) => `item-${i}`));
  const complete = actual.size === expected.size && [...expected].every((item) => actual.has(item));
  check('no item is duplicated or truncated', complete, `actual=${[...actual].join(', ')}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
