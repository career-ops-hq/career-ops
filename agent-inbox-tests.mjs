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
 *   4b. resolve holds the same lock as add for its full read/modify/write, so a
 *       request accepted concurrently cannot be overwritten by a stale view.
 *   5. An empty `add` fails loudly (exit 1) rather than queuing a blank line.
 *   6. On the default path, a first `add` self-heals .gitignore (idempotent) so
 *      the personal queue isn't accidentally tracked.
 *   7. Concurrent `add` calls all survive — the queue is appended to, never
 *      rewritten, so simultaneous writers cannot clobber each other.
 *   7c. When a writer in 7 dies, the line 7 prints names the cause. It did not:
 *      a macOS failure reported `Node.js v24.18.0` — the last-line fallback —
 *      on the one crash that had a cause to give.
 *   8. The queue file is SEEDED under the lock too, not merely appended to under
 *      it. Creating it is open() then write(), and a writer that observed the
 *      gap appended into a zero-byte file and lost its item to the header.
 *   9. The lock underneath 7 is never held by two processes at once. 7 reports
 *      WHAT was lost; 9 reports whether the lock is WHY, so a red run separates
 *      "two writers got in" from "a write went missing" without a round trip.
 *
 * Provisions a throwaway queue via CAREER_OPS_INBOX and a temp CWD; never
 * touches real user data.
 */

import { execFileSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { acquirePipelineLock } from './pipeline-lock.mjs';

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

// Reduce a crashed child's stderr to the one line that names the cause.
//
// Node prints the offending SOURCE LINE before the error itself, so taking the
// first lines verbatim buries the one fact worth having. Anchor on Node's own
// caret rather than guessing at error NAMES: the uncaught-exception preamble is
// <file>:<line> / <source> / ^ / <the error>, so the line after the caret is the
// failure whatever its shape. Name-matching cannot be the primary route — a
// promise rejected with a non-Error prints the bare VALUE (`plain string`,
// `undefined`) with no name to match at all.
//
// This is not hypothetical. macOS run 32166774680 reported
// `item-4 exited 1: Node.js v24.18.0` — the last-line fallback, meaning both
// the name and errno routes missed everything, on the one §7 failure so far
// that had a cause to give. §7c below locks each route against real captured
// output so that cannot recur silently.
export function causeOf(stderr) {
  const lines = String(stderr).trim().split('\n').map((s) => s.trim()).filter(Boolean);
  const caret = lines.findIndex((s) => /^\^+$/.test(s));
  const afterCaret = caret >= 0 && lines[caret + 1] && !/^Node\.js v/.test(lines[caret + 1])
    ? lines[caret + 1]
    : null;
  return afterCaret
    // No mandatory leading character. This class was `^[A-Za-z_$][\w$]*`, which
    // consumed the `E` and left `(Error|Exception)` needing a SECOND literal
    // `Error` after it — so it matched `TypeError:` and `LockTimeoutError:` and
    // never plain `Error:`, the commonest shape there is.
    || lines.find((s) => /^[\w$]*(Error|Exception):/.test(s))
    // ENOTEMPTY is the one that matters for a lock-directory removal racing
    // another process's owner.json write. It prints as a bare `Error:` line, so
    // with the class above it fell through both routes at once.
    || lines.find((s) => /\b(EPERM|EBUSY|EACCES|ENOENT|EEXIST|ENOTEMPTY|EMFILE|EAGAIN|EPIPE)\b/.test(s))
    || lines.slice(-1)[0]
    || '(no stderr)';
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
console.log('4b. resolve waits for the queue lock before rewriting');
{
  const dir = tmp('inbox-resolve-lock-');
  const inbox = join(dir, 'agent-inbox.md');
  writeFileSync(inbox, '# Agent Inbox\n\n- [ ] 2026-01-01 00:00 — alpha\n- [ ] 2026-01-01 00:01 — beta\n');
  const held = await acquirePipelineLock(inbox, { timeoutMs: 10_000 });
  const child = spawn(NODE, [CLI, 'resolve', '1', '--result', 'done alpha'], {
    cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((res) => child.on('close', (code) => res(code)));
  const whileHeld = await Promise.race([
    closed.then(() => 'closed'),
    // A fresh Node process starts in tens of milliseconds on the hosted
    // runners. Half a second keeps the negative control decisive without
    // making the suite inherit the lock's 30-second production timeout.
    new Promise((res) => setTimeout(() => res('waiting'), 500)),
  ]);
  check('resolve stays blocked while another writer owns the queue lock', whileHeld === 'waiting', `state=${whileHeld}`);
  held.release();
  const exit = await closed;
  check('resolve exits cleanly after the lock is released', exit === 0, `exit=${exit}, stderr=${stderr.trim()}`);
  const md = readFileSync(inbox, 'utf8');
  check('the selected item is resolved from the locked snapshot', /^- \[x\].*alpha.*→ result: done alpha/m.test(md), md);
  check('the sibling pending item survives the rewrite', /^- \[ \].*beta/m.test(md), md);
  check('resolve reports the selected item after committing', /Resolved #1: .*alpha/.test(stdout), stdout.trim());
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
    const cause = causeOf(l.err);
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

// ---------------------------------------------------------------------------
console.log('7c. a crashed writer\'s cause survives extraction');
{
  // §7 only helps if the line it prints names the failure. It did not: macOS
  // run 32166774680 crashed a writer and reported `Node.js v24.18.0`, the
  // last-line fallback. So the reporting path gets its own coverage, against
  // REAL child stderr rather than hand-written fixtures — hand-written ones
  // cannot drift when Node changes its crash format, which is exactly the
  // drift that would put us back to printing a banner.
  const dir = tmp('inbox-cause-');
  const shape = (name, src) => {
    writeFileSync(join(dir, `${name}.mjs`), src);
    return execFileSync(NODE, ['-e', `
      const {spawn} = require('child_process');
      const p = spawn(process.execPath, [${JSON.stringify(join(dir, `${name}.mjs`))}], {stdio:['pipe','pipe','pipe']});
      let e = ''; p.stderr.on('data', (c) => { e += c; });
      p.on('close', () => process.stdout.write(e));
    `], { encoding: 'utf8' });
  };

  // Every shape a writer can die in. The four marked LOST below all reduced to
  // the Node banner before this fix; `undefined` is the harshest — a rejection
  // with no name, no message and no errno to match on.
  const SHAPES = [
    ['bare Error       ', `throw new Error('boom');`,                                    'Error: boom'],
    ['async bare Error ', `async function f(){ throw new Error('boom'); } await f();`,   'Error: boom'],
    ['non-Error reject ', `await Promise.reject('plain string');`,                       'plain string'],
    ['undefined reject ', `await Promise.reject();`,                                     'undefined'],
    ['typed Error      ', `throw new TypeError('typed');`,                               'TypeError: typed'],
    ['custom Error     ', `class LockTimeoutError extends Error{}\nthrow new LockTimeoutError('held 30s');`, 'LockTimeoutError: held 30s'],
  ];
  for (const [label, src, want] of SHAPES) {
    const got = causeOf(shape(label.trim().replace(/\W+/g, '-'), src));
    check(`cause survives: ${label.trim()}`, got.startsWith(want), `got "${got.slice(0, 70)}"`);
  }

  // The errno route, exercised through a real syscall rather than a string. A
  // lock directory that still holds owner.json is precisely the release-vs-write
  // race, and ENOTEMPTY was absent from the old list.
  writeFileSync(join(dir, 'notempty.mjs'), [
    `import {mkdirSync, writeFileSync, rmdirSync} from 'node:fs';`,
    `mkdirSync(${JSON.stringify(join(dir, 'lockdir'))}, {recursive:true});`,
    `writeFileSync(${JSON.stringify(join(dir, 'lockdir', 'owner.json'))}, '{}');`,
    `rmdirSync(${JSON.stringify(join(dir, 'lockdir'))});`,
  ].join('\n'));
  const enotempty = causeOf(shape('notempty', readFileSync(join(dir, 'notempty.mjs'), 'utf8')));
  check('cause survives: ENOTEMPTY on a non-empty lock dir', /ENOTEMPTY/.test(enotempty), `got "${enotempty.slice(0, 70)}"`);

  // Pin the two defects directly, so a future tidy-up of the patterns above
  // fails here with the reason rather than silently restoring the banner.
  const NAME_ROUTE = /^[\w$]*(Error|Exception):/;
  check('the name route matches a BARE Error:, not just prefixed classes',
    NAME_ROUTE.test('Error: boom') && NAME_ROUTE.test('TypeError: x'),
    'a leading [A-Za-z_$] here consumes the E and requires a second literal Error');
  check('the errno route covers ENOTEMPTY, not only the five it shipped with',
    ['EPERM', 'EBUSY', 'EACCES', 'ENOENT', 'EEXIST', 'ENOTEMPTY']
      .every((c) => /\b(EPERM|EBUSY|EACCES|ENOENT|EEXIST|ENOTEMPTY|EMFILE|EAGAIN|EPIPE)\b/.test(`Error: ${c}: x`)));

  // Negative control: without it the six assertions above prove nothing, since
  // a fallback that returns the banner still "returns a string". Confirm the
  // shipped extractor really did lose these, on this same captured output.
  const SHIPPED = (stderr) => {
    const lines = String(stderr).trim().split('\n').map((s) => s.trim()).filter(Boolean);
    return lines.find((s) => /^[A-Za-z_$][\w$]*(Error|Exception):/.test(s))
      || lines.find((s) => /\b(EPERM|EBUSY|EACCES|ENOENT|EEXIST)\b/.test(s))
      || lines.slice(-1)[0] || '(no stderr)';
  };
  const lost = SHAPES
    .filter(([, src]) => /^Node\.js v/.test(SHIPPED(shape('ctl', src))))
    .map(([label]) => label.trim());
  check('negative control: the previous extractor lost the bare-Error shapes',
    lost.length === 4 && lost.every((l) => /bare Error|reject/.test(l)),
    `lost=[${lost.join(', ')}]`);
}

// ---------------------------------------------------------------------------
console.log('8. the queue file is seeded under the lock, not before it');
{
  // §7 asserts the concurrent adds all survive. This asserts the reason they
  // can: the file is created AND its header written while the lock is held, so
  // no other writer can ever observe it mid-initialisation.
  //
  // The distinction is not academic. `wx` makes the CREATE atomic but not the
  // INITIALISATION — writeFileSync is open() then write(), and between them the
  // file exists at zero bytes. Measured on Windows, a second process polling
  // existsSync saw it empty in 303 of 400 rounds. A writer that looked in that
  // window skipped creation, appended into the empty file, and had its line
  // overwritten when the 479-byte header landed at offset 0: every process
  // exited 0 and the queue came out well-formed and one item short — §7's
  // `kept=29 of 30` with nothing to show for it. Seeding OUTSIDE the lock is
  // what made that window reachable.
  //
  // Asserted deterministically rather than by racing for it: the test holds the
  // lock itself, so a seed that happens before acquisition shows up as a file
  // existing at a moment when no writer can possibly be in the critical
  // section. Racing would reproduce it only on a loaded multi-core runner,
  // which is precisely the flake this replaces.
  const dir = tmp('inbox-seed-');
  const inbox = join(dir, 'agent-inbox.md');
  const held = await acquirePipelineLock(inbox, { timeoutMs: 10_000 });

  const child = spawn(NODE, [CLI, 'add', 'seeded under the lock'], {
    cwd: ROOT, env: { ...process.env, CAREER_OPS_INBOX: inbox }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', (c) => { childErr += c; });
  const finished = new Promise((res) => child.on('exit', res));

  // Generous, because a false green here is the one outcome worth avoiding: the
  // pre-fix ensureFile() ran before the first lock attempt, so the file
  // appeared as soon as the process finished booting.
  const appearedWhileLocked = await new Promise((res) => {
    const deadline = Date.now() + 2_000;
    const poll = () => {
      if (existsSync(inbox)) return res(true);
      if (Date.now() > deadline) return res(false);
      setTimeout(poll, 25);
    };
    poll();
  });
  check('queue file is NOT created while another process holds the lock', appearedWhileLocked === false);

  held.release();
  const code = await finished;
  check('the blocked add still completes once the lock frees', code === 0,
    childErr.trim().split('\n').slice(-2).join(' | '));
  const md = existsSync(inbox) ? readFileSync(inbox, 'utf8') : '';
  check('header was seeded', /^# Agent Inbox/.test(md) && /Agent protocol:/.test(md), md.slice(0, 60));
  check('the item landed after the header', /^- \[ \] .*seeded under the lock/m.test(md), md);
}

// ---------------------------------------------------------------------------
console.log('9. the lock is never held by two processes at once');
{
  // Case 7 says WHAT was lost. This says WHETHER THE LOCK IS THE REASON.
  //
  // When 7 goes red on windows-latest the log reads `kept=27 of 30` with every
  // child exiting 0, and several very different explanations fit that equally
  // well:
  //
  //   - the lock let two writers in at once, so their appends interleaved and
  //     one overwrote the other;
  //   - the lock held perfectly and the append itself lost a write; or
  //   - the lock held perfectly and the loss happened BEFORE it, while the file
  //     was still being seeded — which is what it actually turned out to be
  //     (#3118), and what 8 now pins directly.
  //
  // Nothing in 7 separates them, so each red run costs a round trip of guessing.
  // This case answers it directly by measuring the property in question —
  // mutual exclusion — instead of its downstream symptom.
  //
  // Each child records its own hold interval to its OWN file. That is
  // deliberate: a shared log would reintroduce the concurrent-append question
  // under test, and a line lost from it could not be told apart from a lock
  // failure. Separate files keep the two independent. The parent then looks for
  // overlapping [enter, exit] intervals — any overlap means two processes were
  // inside the critical section together.
  //
  // Read the three together:
  //   7 red + 8 red             -> the seed ran outside the lock: a writer
  //                                appended into a file whose header had not
  //                                landed, and lost its line to it.
  //   7 red + 9 red             -> the lock was double-held; the append is
  //                                downstream of that.
  //   7 red + 8 green + 9 green -> the seed was under the lock and the lock
  //                                held; suspect the append itself.
  //   9 red alone               -> a lock bug that has not yet cost an item.
  const dir = tmp('inbox-holds-');
  const outDir = join(dir, 'holds');
  mkdirSync(outDir);
  const N = 30;
  const HOLD_MS = 8;
  // Every child signals readiness and then blocks until the PARENT releases
  // them, so all N are provably at the start line before any of them acquires.
  //
  // This barrier is the difference between a test and a decoration. Without one
  // the children simply start when `spawn` gets round to them — hundreds of
  // milliseconds apart — and a short hold never overlaps ANOTHER hold even when
  // there is no lock at all. Verified: with mutual exclusion removed outright,
  // the un-barriered version of this case still PASSED. Staggered starts were
  // doing the serialising, not the lock.
  //
  // A fixed wall-clock start was the first fix and is not enough either: it
  // assumes every child is up within the window, and a loaded runner can start
  // one after the earlier holds have already finished. That reintroduces the
  // same false green in the one environment this case exists to explain, so
  // readiness is counted rather than assumed.
  const readyDir = join(dir, 'ready');
  const goFile = join(dir, 'go');
  mkdirSync(readyDir);

  // Small enough to be obviously correct, and it drives the SAME
  // withPipelineLock that add() uses — this is the real lock, not a model of it.
  const holder = join(dir, 'hold-once.mjs');
  writeFileSync(holder, `
import { writeFileSync, existsSync } from 'node:fs';
import { withPipelineLock } from ${JSON.stringify(pathToFileURL(join(ROOT, 'pipeline-lock.mjs')).href)};
const [,, target, out, id, readyFile, goFile] = process.argv;
writeFileSync(readyFile, '1');
// Spin on the release rather than sleeping: a timer would hand control back to
// the loop and let this process drift a scheduling slice behind the others,
// which is the stagger the barrier exists to remove.
while (!existsSync(goFile)) { /* wait for the others to line up */ }
try {
  await withPipelineLock(target, () => {
    const enter = process.hrtime.bigint();
    // Busy-wait rather than await: the critical section has to occupy real
    // wall-clock time without yielding, so an overlap is a genuine overlap and
    // not two holds that merely interleaved on the event loop.
    const until = Date.now() + ${HOLD_MS};
    while (Date.now() < until) { /* hold it */ }
    writeFileSync(out, JSON.stringify({ id, enter: enter.toString(), exit: process.hrtime.bigint().toString() }));
  });
} catch (err) {
  writeFileSync(out, JSON.stringify({ id, error: err?.code ?? err?.name ?? 'ERR' }));
}
`, 'utf8');

  const target = join(dir, 'pipeline.md');
  const exits = await new Promise((resolveAll) => {
    const codes = [];
    let done = 0;
    for (let i = 0; i < N; i++) {
      const p = spawn(NODE, [holder, target, join(outDir, `${i}.json`), String(i), join(readyDir, `${i}`), goFile], {
        cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
      });
      p.on('exit', (code) => {
        codes.push({ id: i, code });
        if (++done === N) resolveAll(codes);
      });
    }
    // Release only once every child is provably parked on the barrier. The
    // deadline is a backstop, not the mechanism: if a child never checks in the
    // case must fail on the assertions below rather than quietly measuring a
    // smaller herd than it claims.
    const deadline = Date.now() + 20_000;
    const waitForReady = () => {
      if (readdirSync(readyDir).length >= N || Date.now() > deadline) {
        writeFileSync(goFile, '1');
        return;
      }
      setTimeout(waitForReady, 10);
    };
    waitForReady();
  });

  const holds = [];
  const errored = [];
  for (const f of readdirSync(outDir)) {
    const rec = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
    if (rec.error) errored.push(`#${rec.id}:${rec.error}`);
    else holds.push({ id: rec.id, enter: BigInt(rec.enter), exit: BigInt(rec.exit) });
  }

  // A child that died before writing its record leaves no error file either, so
  // counting only what turned up would let a crash shrink the herd and still
  // report a clean run — fewer holders contending, no overlap found, green.
  // Exit status and record count are both required, or the case can pass by
  // measuring less than it claims to.
  const crashed = exits.filter((e) => e.code !== 0).map((e) => `#${e.id}:exit=${e.code}`);
  check(`all ${N} holder processes exited cleanly`, crashed.length === 0, crashed.join(', '));
  check(`all ${N} holders recorded an interval`, holds.length + errored.length === N,
    `${holds.length} intervals + ${errored.length} errors = ${holds.length + errored.length} of ${N}`);

  // An acquire that failed outright is a different fault from a double-hold,
  // and folding them together would make this case lie about which happened.
  check(`all ${N} holders acquired the lock`, errored.length === 0, errored.join(', '));

  holds.sort((a, b) => (a.enter < b.enter ? -1 : a.enter > b.enter ? 1 : 0));
  const overlaps = [];
  // Compare against the interval with the LATEST exit so far, not simply the
  // previous one. Sorted by entry, a long hold can span several later ones, and
  // adjacent-only comparison still turns the case red — the first contained
  // interval overlaps its predecessor — but it under-reports which holders were
  // involved. For a case whose whole job is to explain a red run, the roster
  // has to be complete.
  let widest = holds[0];
  for (let i = 1; i < holds.length; i++) {
    const cur = holds[i];
    if (widest && cur.enter < widest.exit) {
      overlaps.push(`#${widest.id} held until ${widest.exit}, #${cur.id} entered ${cur.enter}`);
    }
    if (!widest || cur.exit > widest.exit) widest = cur;
  }
  check(
    'no two holders were inside the critical section at the same time',
    overlaps.length === 0,
    overlaps.slice(0, 3).join(' | '),
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
