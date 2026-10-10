/**
 * Regression tests for the shared applications.md writer lock.
 *
 * A node:test suite, so test-all.mjs runs it as a child process under the
 * shared 30s cap like every other suite in tests/. It used to sit at the root
 * as tracker-writer-lock-tests.mjs with a 180s budget of its own (#2906),
 * because on Windows it spent most of its time idling: each writer case waited
 * up to 2s to SEE a recover guard that lives for well under a millisecond, and
 * every miss burned the full 2s. A waiting writer now leaves a durable marker
 * once it has created that guard (#4762), so there is nothing to miss, and
 * the suite fits the shared cap (#4759).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireTrackerLock, openTrackerTransaction } from '../tracker-utils.mjs';
import { waitForContentionMarker } from './helpers/tracker-contention-marker.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
const CONCURRENT_ROW = '| 99 | 2026-01-03 | ConcurrentCo | Keeper | 4.3/5 | Applied | ❌ | [99](reports/099-concurrent.md) | preserve me |';
// The first writer case whose writer never left its contention marker, if
// any. Learning that costs the writer's whole 3s lock timeout, because "not
// yet" and "never" look the same until it gives up. When the marker is gone
// every case pays it, which put a red run at 28s locally against a 30s cap, so
// on a slower runner the regression would arrive as an unexplained suite kill.
// One case pays instead, and the rest fail straight away, naming it.
let markerFirstMissed = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// A harness deadline raced against a child. Unref'd, because the race usually
// ends the other way and node:test waits for the event loop to drain before
// the file finishes: a pending 10s timer per case kept this suite alive for
// seconds after its last test. The child being waited on keeps the loop alive
// for as long as the deadline matters.
const deadline = (ms) => new Promise(resolve => setTimeout(resolve, ms).unref());

// How long the HARNESS waits for a spawned Node process to start, print, or
// exit. This is not a value under test: it encodes only how fast the machine
// is. A Windows CI runner under load routinely needs more than the 2s this
// file once allowed, which made a correctness test fail for want of a faster
// host, so it is generous. It is also well under the 30s test-all gives the
// whole suite: a writer that hangs is killed here and reported as the case
// that hung, rather than taking the suite down with the outer cap and naming
// nothing.
//
// The SEMANTIC timeouts are the argument to launchWriter() (the child's
// CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) and the lock's own timeoutMs / staleMs /
// retryMs. Those are what the tests assert on.
const HARNESS_WAIT_MS = 10_000;

// The probe's lock timeout. The probe only has to time out while the lock is
// held, and the deadline starts inside acquireTrackerLock, after the module has
// loaded and the writer's pre-lock work is done, so a short one cannot race
// process startup. It was 200ms, which nine probes paid in full (#4759).
const PROBE_LOCK_TIMEOUT_MS = 50;

// Every writer this file starts, until it closes. test-all caps a node:test
// suite by killing `node --test`; the runner forwards SIGTERM to this process,
// which then dies without running any per-case cleanup, and a writer it was
// waiting on is left running. Killing them here keeps a timeout from leaving
// strays. Best effort: Windows delivers no SIGTERM to listen for, though a
// writer orphaned there still exits on its own lock timeout.
const liveChildren = new Set();

function startNode(args, options) {
  const child = spawn(NODE, args, options);
  liveChildren.add(child);
  child.once('close', () => liveChildren.delete(child));
  return child;
}

function killLiveChildren() {
  for (const child of liveChildren) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

process.once('exit', killLiveChildren);
for (const signal of ['SIGTERM', 'SIGINT']) {
  // Re-raised once the children are gone: `once` has removed this listener by
  // then, so the signal's default action ends the process as it would have.
  process.once(signal, () => {
    killLiveChildren();
    process.kill(process.pid, signal);
  });
}

function trackerTable(rows) {
  return `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
${rows.join('\n')}
`;
}

/**
 * Hold the tracker lock, prove a writer contends on it, then let the writer
 * run and report what it left behind. Collects evidence only: the assertions
 * live in writerCase(), one subtest per claim. The verify callbacks run here
 * because some resolve the tracker's real path, which needs the fixture
 * directory still on disk.
 */
async function runWhileLocked({
  name,
  script,
  args = [],
  content,
  stdin = '',
  candidates = null,
  verify,
  verifyConcurrent,
  verifyOutput,
  mutateWhileLocked,
  beforeMutationOutput = null,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-writer-lock-'));
  const tracker = join(dir, 'applications.md');
  const lockDir = join(dir, `career-ops-merge-tracker-${name}.lock`);
  const db = join(dir, 'applications.db');
  writeFileSync(tracker, content);

  if (name.startsWith('reply-watch')) {
    const candidatesFile = join(dir, 'candidates.json');
    writeFileSync(candidatesFile, JSON.stringify(candidates || [{
      message_id: 'reply-1',
      from: 'hr@acme.com',
      subject: 'Unfortunately, an update on your Acme Engineer application',
      body_snippet: 'We decided not to proceed with your application.',
      signal: 'rejection',
    }]));
    args = [candidatesFile];
  }

  const childEnv = {
    ...process.env,
    CAREER_OPS_TRACKER: tracker,
    CAREER_OPS_TRACKER_DB: db,
    CAREER_OPS_TRACKER_LOCK: lockDir,
    CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
  };
  const launchWriter = (timeoutMs, markerPath = null) => {
    let stdout = '';
    let stderr = '';
    const resolvedArgs = args.map(arg => arg === '{tracker}' ? tracker : arg);
    const child = startNode([join(ROOT, script), ...resolvedArgs], {
      cwd: ROOT,
      env: {
        ...childEnv,
        // Test-only: acquireTrackerLock writes this marker once it has found
        // the lock held and created the recover guard (tracker-utils.mjs).
        ...(markerPath ? {
          NODE_ENV: 'test',
          CAREER_OPS_TRACKER_TEST_LOCK_WAIT_MARKER: markerPath,
        } : {}),
        CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: String(timeoutMs),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    let closed = false;
    const closePromise = new Promise(resolve => child.once('close', code => {
      closed = true;
      resolve({ code });
    }));
    child.stdin.end(stdin);
    return {
      child,
      closePromise,
      closed: () => closed,
      output: () => ({ stdout, stderr }),
    };
  };
  const waitForWriter = async (run, timeoutMs) => {
    let result = await Promise.race([
      run.closePromise,
      deadline(timeoutMs).then(() => null),
    ]);
    if (result === null) {
      run.child.kill('SIGKILL');
      result = await run.closePromise;
      return { ...result, timedOut: true };
    }
    return { ...result, timedOut: false };
  };

  const evidence = {
    probe: null, reachedPrompt: null, watched: false, marker: null, markerNotAwaited: null, lockDir, run: null,
  };
  try {
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 2_000,
      retryMs: 20,
      staleMs: 5_000,
      tracker,
    });

    const probe = launchWriter(PROBE_LOCK_TIMEOUT_MS);
    const probeResult = await waitForWriter(probe, HARNESS_WAIT_MS);
    const probeOutput = probe.output();
    evidence.probe = {
      ...probeResult,
      output: `${probeOutput.stdout}${probeOutput.stderr}`,
      trackerAfter: readFileSync(tracker, 'utf-8'),
    };

    const markerPath = beforeMutationOutput ? null : join(dir, `${name}.lock-waiting.json`);
    const run = launchWriter(3_000, markerPath);
    evidence.runPid = run.child.pid;
    try {
      if (beforeMutationOutput) {
        const promptDeadline = Date.now() + HARNESS_WAIT_MS;
        while (!run.output().stdout.includes(beforeMutationOutput) && Date.now() < promptDeadline) {
          await sleep(10);
        }
        evidence.reachedPrompt = run.output().stdout.includes(beforeMutationOutput);
      } else {
        // Order the mutation after the writer's own read.
        //
        // WHY THIS EXISTS: the fixture mutation below is what a writer with a
        // stale pre-lock snapshot erases, so it only discriminates if it lands
        // AFTER that writer's read. Committing it immediately after spawn()
        // does not: a fresh Node process needs tens of milliseconds just to
        // boot, so the row is already on disk before a buggy writer reads, and
        // the buggy writer then reads the post-mutation file and passes. That
        // was verified, not assumed — hoisting set-status.mjs's readFileSync
        // above its acquireTrackerLockForCli call left this suite fully green
        // until a wait was added.
        //
        // The signal is the marker the writer leaves once it has tried the
        // lock, found it held, and created the recover guard. That instant
        // sits after a pre-lock read and before a post-lock one, which is
        // exactly the discrimination the mutation needs. It replaces sampling
        // the recover guard itself with readdirSync: the guard exists for well
        // under a millisecond per retry, Windows CI missed it in 3 of 8 cases
        // and 0 of 8 on another leg, and each miss idled 2s before falling back
        // to timing-dependent ordering (#4759). The marker stays on disk, so
        // it cannot be missed, and its absence is a real failure (#4762).
        //
        // beforeMutationOutput entries have a stronger, script-specific
        // ordering signal (their pre-lock review prompt), and a writer parked
        // at that prompt has not reached the lock yet, so they skip this.
        evidence.watched = true;
        if (markerFirstMissed) {
          evidence.markerNotAwaited = markerFirstMissed;
        } else {
          // Stops early once the writer has exited: no marker can arrive then.
          evidence.marker = await waitForContentionMarker(markerPath, HARNESS_WAIT_MS, { stopWhen: run.closed });
          if (!evidence.marker) markerFirstMissed = name;
        }
      }
      // Simulate the current lock owner committing another row. The waiting
      // writer must read this fresh version after acquiring the lock; a writer
      // that reads before locking will erase row #99 with its stale snapshot.
      const nextContent = mutateWhileLocked
        ? mutateWhileLocked(content, CONCURRENT_ROW)
        : `${content.trimEnd()}\n${CONCURRENT_ROW}\n`;
      writeFileSync(tracker, nextContent);
    } finally {
      lock.release();
    }

    const result = await waitForWriter(run, HARNESS_WAIT_MS);
    const { stdout, stderr } = run.output();
    const after = existsSync(tracker) ? readFileSync(tracker, 'utf-8') : '';
    evidence.run = {
      ...result,
      stdout,
      stderr,
      after,
      updated: verify(after),
      concurrentKept: verifyConcurrent(after),
      outputMatches: verifyOutput(stdout, stderr, tracker),
    };
    return evidence;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One writer in the matrix: a test per writer, with a subtest for each claim
 * it makes (it contends on the shared lock; where the mutation is ordered on
 * the marker, it signals contention after creating the recover guard; it
 * completes against the fresh tracker once the lock is released).
 */
function writerCase({
  verifyConcurrent = after => after.includes(CONCURRENT_ROW),
  verifyOutput = () => true,
  completion = 'completes the intended update after lock release',
  ...options
}) {
  const { name, content } = options;
  test(name, async (t) => {
    const outcome = runWhileLocked({ ...options, verifyConcurrent, verifyOutput });
    // Every subtest reads the one run; an error in it fails each, by name.
    outcome.catch(() => {});

    await t.test('contends on the shared lock before reading or writing', async () => {
      const { probe } = await outcome;
      const detail = `exit=${probe.code}, timedOut=${probe.timedOut}\n${probe.output}`;
      assert.equal(probe.timedOut, false, `lock contention probe hung (${detail})`);
      assert.notEqual(probe.code, 0, `lock contention probe exited 0 while the lock was held (${detail})`);
      assert.ok(probe.output.includes('Timed out waiting for tracker lock'),
        `lock contention probe did not time out on the lock (${detail})`);
      assert.equal(probe.trackerAfter, content, 'lock contention probe changed the tracker without the lock');
    });

    // Only the cases that order their mutation on the marker make this claim;
    // a writer parked at a pre-lock prompt has not reached the lock yet.
    if (!options.beforeMutationOutput) {
      await t.test('signals contention durably after creating the recover guard', async () => {
        const { marker, markerNotAwaited, lockDir, runPid } = await outcome;
        assert.equal(markerNotAwaited, null,
          `not waited for: the writer in ${markerNotAwaited} never left its contention marker, `
          + 'so this case did not spend 3s learning the same thing (see that case for the cause)');
        assert.ok(marker,
          'the writer left no contention marker, so the fixture mutation was not ordered after its read — '
          + 'the CAREER_OPS_TRACKER_TEST_LOCK_WAIT_MARKER hook in tracker-utils.mjs is gone, renamed, or no '
          + 'longer reached on contention');
        assert.equal(marker.lockDir, lockDir, 'the marker names a different lock');
        assert.equal(marker.guardCreated, true, 'the marker does not record the recover guard being created');
        assert.equal(marker.pid, runPid, 'the marker came from a different process');
      });
    }

    await t.test(completion, async () => {
      const { run, reachedPrompt } = await outcome;
      assert.notEqual(reachedPrompt, false, 'did not reach the pre-lock review prompt before the fixture mutation');
      const detail = `exit=${run.code}, timedOut=${run.timedOut}\n${run.stdout}${run.stderr}\n${run.after}`;
      assert.equal(run.timedOut, false, `writer hung after lock release (${detail})`);
      assert.equal(run.code, 0, `writer failed after lock release (${detail})`);
      assert.ok(run.updated, `writer did not make its update (${detail})`);
      assert.ok(run.concurrentKept, `writer lost the row committed while it waited (${detail})`);
      assert.ok(run.outputMatches, `writer output is not what was expected (${detail})`);
    });
  });
}

writerCase({
  name: 'normalize-statuses',
  script: 'normalize-statuses.mjs',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Aplicado | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| Applied |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`Written to ${realpathSync(tracker)}`)
    && stdout.includes(`${realpathSync(tracker)}.bak`),
});

writerCase({
  name: 'dedup-tracker',
  script: 'dedup-tracker.mjs',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | first |',
    '| 2 | 2026-01-02 | Acme | Engineer | 3.0/5 | Evaluated | ❌ | [2](reports/002-acme.md) | duplicate |',
  ]),
  verify: content => (content.match(/\| Acme \| Engineer \|/g) || []).length === 1,
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`Written to ${realpathSync(tracker)}`)
    && stdout.includes(`${realpathSync(tracker)}.bak`),
});

writerCase({
  name: 'tracker-delete',
  script: 'tracker.mjs',
  args: ['delete', '--num', '1'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
    '| 2 | 2026-01-02 | Beta | Analyst | 3.5/5 | Evaluated | ❌ | [2](reports/002-beta.md) | keep |',
  ]),
  verify: content => !content.includes('| 1 | 2026-01-01 | Acme |') && content.includes('| 2 | 2026-01-02 | Beta |'),
});

writerCase({
  name: 'tracker-export',
  script: 'tracker.mjs',
  args: ['export', '--out', '{tracker}'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme |')
    && content.includes(CONCURRENT_ROW),
  verifyOutput: (_stdout, stderr, tracker) => stderr.includes('Exported 2 applications')
    && existsSync(`${realpathSync(tracker)}.bak`),
  completion: 'exports the fresh locked snapshot without losing concurrent rows',
});

// set-status.mjs is the writer CLAUDE.md names as canonical — the one every
// mode calls to move a row — so it is the single most important entry in this
// matrix, and it was the one missing. set-status-tests.mjs already covers the
// lock TIMEOUT (exit 4) and a non-retryable lock error, but both prove only
// that it contends; neither can tell a writer that re-reads under the lock
// apart from one that reads first and writes a stale snapshot back. Hoisting
// the readFileSync above acquireTrackerLockForCli looks like a harmless
// optimisation ("resolve the row before paying for the lock"), and the file
// already does real pre-lock work validating the state against states.yml, so
// the shape is inviting. This test is what makes that refactor fail.
writerCase({
  name: 'set-status',
  script: 'set-status.mjs',
  args: ['--row', '1', 'Applied', '--note', 'sent CV'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied |')
    && content.includes('| seed; sent CV |'),
  verifyOutput: stdout => stdout.includes('set Evaluated → Applied'),
});

// mark-pdf-ready.mjs is the canonical writer for the PDF column and shares
// set-status.mjs's locked read-modify-write path (acquireTrackerLockForCli in
// tracker-utils.mjs). It rewrites one cell of one line and keeps the rest of
// the file, so a pre-lock read costs the same concurrent rows here as anywhere
// else in this matrix.
writerCase({
  name: 'mark-pdf-ready',
  script: 'mark-pdf-ready.mjs',
  args: ['1'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ✅ |'),
  verifyOutput: stdout => stdout.includes('marked PDF ready'),
});

writerCase({
  name: 'reply-watch',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  verify: content => content.includes('| Rejected |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`to ${realpathSync(tracker)}?`),
});

writerCase({
  name: 'reply-watch-identical',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  candidates: [
    {
      message_id: 'reply-1',
      from: 'hr@acme.com',
      subject: 'Unfortunately, an update on your Acme Engineer application',
      body_snippet: 'We decided not to proceed with your application.',
      signal: 'rejection',
    },
    {
      message_id: 'reply-2',
      from: 'hr@acme.com',
      subject: 'Update on your Acme Engineer application',
      body_snippet: 'Unfortunately, we will not be moving forward with your application.',
      signal: 'rejection',
    },
  ],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  verify: content => content.includes('| Rejected |'),
  verifyOutput: stdout => stdout.includes('2 replies'),
  completion: 'groups identical reply transitions without losing their count',
});

writerCase({
  name: 'reply-watch-stale-status',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  mutateWhileLocked: (content, concurrentRow) => `${content.replace('| Applied |', '| Interview |').trimEnd()}\n${concurrentRow}\n`,
  verify: content => content.includes('| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Interview |')
    && content.includes('| 99 | 2026-01-03 | ConcurrentCo |')
    && !content.includes('| Rejected |'),
  verifyOutput: (stdout, stderr) => `${stdout}${stderr}`.includes('status changed from Applied to Interview during review'),
  completion: 'preserves a status changed while the recommendation was under review',
  beforeMutationOutput: 'Apply recommended status updates',
});

// --- followup-seed.mjs: a separate lock namespace, deliberately -------------
//
// followup-seed.mjs is absent from the matrix above because it is not a
// tracker writer. It READS applications.md to find the row and its apply date,
// then writes only data/follow-ups.md, under its own lock keyed by the
// FOLLOW-UPS path and prefixed `career-ops-followups-` (followup-seed.mjs's
// FOLLOWUPS_LOCK_PREFIX and resolveLockDir) rather than the shared
// `career-ops-merge-tracker-` lock every writer above contends on.
//
// That split is the safe arrangement, not an oversight:
//   - The two locks guard two different files' critical sections. The tracker
//     lock says nothing about follow-ups.md, so a seeder holding it would
//     still race a second seeder; the follow-ups lock is what actually
//     serializes the read-check-append on follow-ups.md, and
//     followup-seed.mjs is the only writer of that file in the repo (every
//     other consumer — followup-cadence, reply-watch, stats, company-history —
//     only reads it).
//   - The stale-snapshot invariant this suite exists for cannot apply. It bites
//     when a writer writes a whole-file snapshot back; followup-seed writes no
//     tracker bytes at all, so a row committed while it runs cannot be erased.
//     Its pre-lock tracker read is therefore an observation that may go stale
//     (a row could leave Applied before the pin lands), never a lost write.
//   - Sharing the tracker lock would serialize every seed behind unrelated
//     tracker writes and, worse, nest two locks, without buying any safety.
//
// The test states all of that as behaviour: it holds the TRACKER lock for the
// whole run and asserts followup-seed (a) completes anyway rather than blocking
// on a lock it has no reason to want, (b) seeds follow-ups.md, and (c) leaves
// the tracker byte-for-byte as the tracker-lock holder left it, concurrent row
// included. Give followup-seed the tracker lock and (a) fails; give it a
// tracker write and (c) fails.
test('followup-seed: seeds follow-ups under its own lock while the tracker lock is held, and writes no tracker bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-followup-seed-lock-'));
  const tracker = join(dir, 'applications.md');
  const followups = join(dir, 'follow-ups.md');
  const trackerLockDir = join(dir, 'career-ops-merge-tracker-followup-seed.lock');
  const followupsLockDir = join(dir, 'career-ops-followups-seed.lock');
  const content = trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | Applied 2026-01-01 |',
  ]);
  writeFileSync(tracker, content);

  try {
    const lock = await acquireTrackerLock(trackerLockDir, {
      timeoutMs: 2_000,
      retryMs: 20,
      staleMs: 5_000,
      tracker,
    });

    // Stand in for the tracker-lock holder committing a row: if followup-seed
    // ever wrote the tracker from a snapshot, this row is what it would erase.
    const lockedContent = `${content.trimEnd()}\n${CONCURRENT_ROW}\n`;
    writeFileSync(tracker, lockedContent);
    // Content alone would miss a writer that replaces the tracker with bytes it
    // happens to have read a moment earlier. writeFileAtomic renames a temp file
    // over the target, so the mtime moves even when the bytes do not.
    const lockedMtimeMs = statSync(tracker).mtimeMs;

    let stdout = '';
    let stderr = '';
    let result;
    try {
      const child = startNode([join(ROOT, 'followup-seed.mjs'), '1', '--json'], {
        cwd: ROOT,
        env: {
          ...process.env,
          CAREER_OPS_TRACKER: tracker,
          CAREER_OPS_FOLLOWUPS: followups,
          CAREER_OPS_FOLLOWUPS_LOCK: followupsLockDir,
          CAREER_OPS_FOLLOWUPS_LOCK_RETRY_MS: '20',
          CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS: '3000',
          // Short enough that a followup-seed which DID reach for the shared
          // tracker lock would time out and fail loudly inside the harness
          // wait, instead of hanging until the suite's own timeout.
          CAREER_OPS_TRACKER_LOCK: trackerLockDir,
          CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '500',
          CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdin.end();
      const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
      result = await Promise.race([closePromise, deadline(HARNESS_WAIT_MS).then(() => null)]);
      if (result === null) {
        child.kill('SIGKILL');
        result = await closePromise;
      }
    } finally {
      // Released only after the child is done, so "completed" means
      // "completed while the tracker lock was held by someone else" — and
      // released even when starting or waiting on the child throws.
      lock.release();
    }

    const after = readFileSync(tracker, 'utf-8');
    const trackerUntouched = after === lockedContent && statSync(tracker).mtimeMs === lockedMtimeMs;
    const seeded = existsSync(followups) ? readFileSync(followups, 'utf-8') : '';
    const detail = `exit=${result.code}\n${stdout}${stderr}\n${after}`;
    assert.equal(result.code, 0, `followup-seed did not complete while the tracker lock was held (${detail})`);
    assert.ok(trackerUntouched, `followup-seed wrote tracker bytes (${detail})`);
    assert.ok(seeded.includes('- next #1 '), `followup-seed did not seed follow-ups.md (${detail})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracker lock release retries after owner.json was removed by partial cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lock-release-'));
  const lockDir = join(dir, 'tracker.lock');
  let removeAttempts = 0;
  try {
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 1_000,
      retryMs: 20,
      staleMs: 5_000,
      tracker: join(dir, 'applications.md'),
      removeLock: path => {
        removeAttempts++;
        if (removeAttempts === 1) {
          rmSync(join(path, 'owner.json'));
          throw new Error('transient cleanup failure');
        }
        rmSync(path, { recursive: true, force: true });
      },
    });

    let firstError = null;
    try {
      lock.release();
    } catch (err) {
      firstError = err;
    }
    const partialCleanupPreservedDir = existsSync(lockDir)
      && !existsSync(join(lockDir, 'owner.json'));
    lock.release();
    assert.match(firstError?.message ?? '', /transient cleanup failure/);
    assert.ok(partialCleanupPreservedDir, 'partial cleanup should leave the lock directory without owner.json');
    assert.equal(removeAttempts, 2);
    assert.ok(!existsSync(lockDir), 'the retried release should remove the lock directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale tracker lock handle preserves a replacement after partial cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-lock-replacement-'));
  const lockDir = join(dir, 'tracker.lock');
  let removeAttempts = 0;
  try {
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 1_000,
      retryMs: 20,
      staleMs: 5_000,
      tracker: join(dir, 'applications.md'),
      removeLock: path => {
        removeAttempts++;
        rmSync(join(path, 'owner.json'));
        throw new Error('transient cleanup failure');
      },
    });
    try { lock.release(); } catch {}

    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      token: 'replacement-owner',
    }));
    lock.release();

    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
    assert.equal(owner.token, 'replacement-owner', 'the stale handle touched the replacement lock');
    assert.equal(removeAttempts, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracker transaction close preserves completed writes and reports cleanup failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-transaction-close-'));
  const tracker = join(dir, 'applications.md');
  const lockDir = join(dir, 'tracker.lock');
  const originalConsoleError = console.error;
  let warning = '';
  try {
    writeFileSync(tracker, 'before');
    const transaction = await openTrackerTransaction(tracker, {
      lockDir,
      removeLock: () => { throw new Error('injected cleanup failure'); },
    });
    transaction.replace('after');
    console.error = (...args) => { warning += args.join(' '); };
    const closeError = transaction.close();
    const repeatedCloseError = transaction.close();
    let rejectedClosedRead = false;
    try { transaction.read(); } catch { rejectedClosedRead = true; }

    console.error = originalConsoleError;
    assert.equal(readFileSync(tracker, 'utf-8'), 'after');
    assert.equal(closeError?.message, 'injected cleanup failure');
    assert.equal(repeatedCloseError, closeError);
    assert.ok(rejectedClosedRead, 'a closed transaction must refuse to read');
    assert.ok(warning.includes('lock cleanup failed'), `missing cleanup warning (warning=${JSON.stringify(warning)})`);
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reply-watch surfaces conflicting replies without applying an arbitrary last status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-reply-conflict-'));
  const tracker = join(dir, 'applications.md');
  const candidatesPath = join(dir, 'candidates.json');
  const db = join(dir, 'applications.db');
  try {
    const initial = trackerTable([
      '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
    ]);
    writeFileSync(tracker, initial);
    writeFileSync(candidatesPath, JSON.stringify([
      {
        message_id: 'reply-rejected',
        from: 'hr@acme.com',
        subject: 'Unfortunately, an update on your Acme Engineer application',
        body_snippet: 'We decided not to proceed with your application.',
        signal: 'rejection',
      },
      {
        message_id: 'reply-interview',
        from: 'hr@acme.com',
        subject: 'Interview invitation for your Acme Engineer application',
        body_snippet: 'We would like to invite you to an interview.',
        signal: 'interview_invite',
      },
    ]));

    let stdout = '';
    let stderr = '';
    const child = startNode([join(ROOT, 'reply-watch.mjs'), candidatesPath], {
      cwd: ROOT,
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: tracker,
        CAREER_OPS_TRACKER_DB: db,
        CAREER_OPS_TRACKER_LOCK: join(dir, 'career-ops-merge-tracker-conflict.lock'),
        CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '1000',
        CAREER_OPS_TRACKER_LOCK_RETRY_MS: '20',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.end();
    const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
    let result = await Promise.race([closePromise, deadline(HARNESS_WAIT_MS).then(() => null)]);
    if (result === null) {
      child.kill('SIGKILL');
      result = await closePromise;
    }
    const output = `${stdout}${stderr}`;
    const detail = `exit=${result.code}\n${output}\n${readFileSync(tracker, 'utf-8')}`;
    assert.equal(result.code, 0, detail);
    assert.equal(readFileSync(tracker, 'utf-8'), initial, `reply-watch applied a status (${detail})`);
    assert.ok(output.includes('Conflicting status recommendations'), detail);
    assert.ok(output.includes('Interview') && output.includes('Rejected'), detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Ownerless-directory grace period (#2306) -------------------------------
//
// A lock is ownerless for the instant between its `mkdirSync` and its
// `owner.json` write, and the recover guard is ownerless for its whole life.
// Judging either on `age > staleMs` alone lets a caller with a small staleMs
// delete a directory created microseconds ago. These tests pin the floor that
// keeps a brand-new ownerless directory off-limits, and — just as importantly —
// pin that a genuinely old one is still reclaimed, so the floor cannot be
// satisfied by disabling recovery outright.

// Backdate a directory's mtime so the age check sees it as genuinely old.
function backdate(path, ms) {
  const when = new Date(Date.now() - ms);
  utimesSync(path, when, when);
}

// The two "must not reclaim" tests describe the boundary the floor creates by
// backdating the ownerless directory into it: older than the caller's staleMs
// (so the unfloored code reclaims on its very first pass) but far younger than
// OWNERLESS_GRACE_MS (so the floored code must not). Stating both sides
// explicitly keeps the tests off the wall clock — asserting against a
// directory created "just now" would instead depend on whether a sub-
// millisecond age drifts past a 1 ms threshold before the loop looks again,
// which is a race, not an assertion.
//
// With the age relation pinned, one pass is enough in both directions, so
// retryMs is set above timeoutMs. That also stops the loop from creating and
// deleting the guard directory a dozen times: Windows defers a directory's
// real removal until the last handle closes, so a tight mkdir/rmdir cycle on
// one path can surface EPERM instead of the timeout under test.
const ONE_PASS = { timeoutMs: 150, retryMs: 200 };
const INSIDE_GRACE_MS = 100;   // ownerless for 100ms: past staleMs, well inside the 1s floor
const SMALL_STALE_MS = 10;

test('ownerless lock inside the grace period is not stolen by a small staleMs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-ownerless-'));
  const lockDir = join(dir, 'tracker.lock');
  try {
    // Stands in for a winner that has run mkdirSync but not yet written
    // owner.json — live, real, and unlabelled inside its acquisition window.
    mkdirSync(lockDir);
    backdate(lockDir, INSIDE_GRACE_MS);
    let acquired = null;
    let err = null;
    try {
      acquired = await acquireTrackerLock(lockDir, {
        ...ONE_PASS, staleMs: SMALL_STALE_MS, tracker: join(dir, 'applications.md'),
      });
    } catch (e) {
      err = e;
    }
    acquired?.release();
    assert.equal(err?.code, 'LOCK_TIMEOUT',
      `ownerless lock inside the grace period was stolen (staleRecovered=${acquired?.staleRecovered}, err=${err?.code})`);
    assert.ok(existsSync(lockDir), 'ownerless lock inside the grace period was removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ownerless lock older than the grace period is still recovered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-ownerless-aged-'));
  const lockDir = join(dir, 'tracker.lock');
  try {
    // A real orphan: ownerless *and* older than any grace period.
    mkdirSync(lockDir);
    backdate(lockDir, 60_000);
    const lock = await acquireTrackerLock(lockDir, {
      timeoutMs: 1_000, retryMs: 20, staleMs: 1, tracker: join(dir, 'applications.md'),
    });
    lock.release();
    assert.ok(lock.staleRecovered, 'aged ownerless lock was not recovered — the grace period must not disable recovery');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recover guard held by a live caller is not evicted by a small staleMs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-guard-live-'));
  const lockDir = join(dir, 'tracker.lock');
  const guardDir = `${lockDir}.recover`;
  try {
    // The lock itself is recoverable (dead owner PID), so the only thing that
    // can hold recovery back is the guard — which another caller is holding
    // right now. Evicting it puts two callers inside the decide-then-delete
    // window the guard exists to serialize.
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, token: 'dead', tracker: 'x' }));
    mkdirSync(guardDir);
    backdate(guardDir, INSIDE_GRACE_MS);

    let acquired = null;
    let err = null;
    try {
      acquired = await acquireTrackerLock(lockDir, {
        ...ONE_PASS, staleMs: SMALL_STALE_MS, tracker: join(dir, 'applications.md'),
      });
    } catch (e) {
      err = e;
    }
    const guardSurvived = existsSync(guardDir);
    acquired?.release();
    assert.equal(err?.code, 'LOCK_TIMEOUT',
      `live recover guard was evicted (staleRecovered=${acquired?.staleRecovered}, err=${err?.code}, guard=${guardSurvived})`);
    assert.ok(guardSurvived, 'live recover guard was removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
