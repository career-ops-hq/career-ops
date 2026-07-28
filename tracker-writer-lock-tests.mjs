#!/usr/bin/env node

/** Regression tests for the shared applications.md writer lock. */

import { spawn } from 'child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { acquireTrackerLock, openTrackerTransaction } from './tracker-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CONCURRENT_ROW = '| 99 | 2026-01-03 | ConcurrentCo | Keeper | 4.3/5 | Applied | ❌ | [99](reports/099-concurrent.md) | preserve me |';
let passed = 0;
let failed = 0;

function pass(message) { console.log(`PASS ${message}`); passed++; }
function fail(message) { console.error(`FAIL ${message}`); failed++; }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function trackerTable(rows) {
  return `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
${rows.join('\n')}
`;
}

async function runWhileLocked({
  name,
  script,
  args = [],
  content,
  stdin = '',
  candidates = null,
  verify,
  mutateWhileLocked,
  verifyConcurrent = after => after.includes(CONCURRENT_ROW),
  verifyOutput = () => true,
  completion = 'completes the intended update after lock release',
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
  const launchWriter = (timeoutMs) => {
    let stdout = '';
    let stderr = '';
    const resolvedArgs = args.map(arg => arg === '{tracker}' ? tracker : arg);
    const child = spawn(NODE, [join(ROOT, script), ...resolvedArgs], {
      cwd: ROOT,
      env: {
        ...childEnv,
        CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: String(timeoutMs),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closePromise = new Promise(resolve => child.once('close', code => resolve({ code })));
    child.stdin.end(stdin);
    return {
      child,
      closePromise,
      output: () => ({ stdout, stderr }),
    };
  };
  const waitForWriter = async (run, timeoutMs) => {
    let result = await Promise.race([
      run.closePromise,
      sleep(timeoutMs).then(() => null),
    ]);
    if (result === null) {
      run.child.kill('SIGKILL');
      result = await run.closePromise;
      return { ...result, timedOut: true };
    }
    return { ...result, timedOut: false };
  };

  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: 2_000,
    retryMs: 20,
    staleMs: 5_000,
    tracker,
  });

  const probe = launchWriter(200);
  const probeResult = await waitForWriter(probe, 2_000);
  const probeOutput = probe.output();
  if (!probeResult.timedOut && probeResult.code !== 0
      && `${probeOutput.stdout}${probeOutput.stderr}`.includes('Timed out waiting for tracker lock')
      && readFileSync(tracker, 'utf-8') === content) {
    pass(`${name}: contends on the shared lock before reading or writing`);
  } else {
    fail(`${name}: lock contention probe failed (exit=${probeResult.code}, timedOut=${probeResult.timedOut})\n${probeOutput.stdout}${probeOutput.stderr}`);
  }

  const run = launchWriter(3_000);

  try {
    if (beforeMutationOutput) {
      const deadline = Date.now() + 2_000;
      while (!run.output().stdout.includes(beforeMutationOutput) && Date.now() < deadline) {
        await sleep(10);
      }
      if (!run.output().stdout.includes(beforeMutationOutput)) {
        fail(`${name}: did not reach the pre-lock review prompt before the fixture mutation`);
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

  const result = await waitForWriter(run, 5_000);
  const { stdout, stderr } = run.output();

  const after = existsSync(tracker) ? readFileSync(tracker, 'utf-8') : '';
  if (!result.timedOut && result.code === 0 && verify(after)
      && verifyConcurrent(after) && verifyOutput(stdout, stderr, tracker)) {
    pass(`${name}: ${completion}`);
  } else {
    fail(`${name}: update failed after lock release (exit=${result.code})\n${stdout}${stderr}\n${after}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

await runWhileLocked({
  name: 'normalize-statuses',
  script: 'normalize-statuses.mjs',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Aplicado | ❌ | [1](reports/001-acme.md) | seed |',
  ]),
  verify: content => content.includes('| Applied |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`Written to ${realpathSync(tracker)}`)
    && stdout.includes(`${realpathSync(tracker)}.bak`),
});

await runWhileLocked({
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

await runWhileLocked({
  name: 'tracker-delete',
  script: 'tracker.mjs',
  args: ['delete', '--num', '1'],
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](reports/001-acme.md) | seed |',
    '| 2 | 2026-01-02 | Beta | Analyst | 3.5/5 | Evaluated | ❌ | [2](reports/002-beta.md) | keep |',
  ]),
  verify: content => !content.includes('| 1 | 2026-01-01 | Acme |') && content.includes('| 2 | 2026-01-02 | Beta |'),
});

await runWhileLocked({
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

await runWhileLocked({
  name: 'reply-watch',
  script: 'reply-watch.mjs',
  stdin: 'y\n',
  content: trackerTable([
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [1](reports/001-acme.md) | contact hr@acme.com |',
  ]),
  verify: content => content.includes('| Rejected |'),
  verifyOutput: (stdout, _stderr, tracker) => stdout.includes(`to ${realpathSync(tracker)}?`),
});

await runWhileLocked({
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

await runWhileLocked({
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

async function testTrackerLockReleaseRetriesPartialCleanup() {
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
    if (firstError?.message.includes('transient cleanup failure')
        && partialCleanupPreservedDir && removeAttempts === 2 && !existsSync(lockDir)) {
      pass('tracker lock release retries after owner.json was removed by partial cleanup');
    } else {
      fail(`tracker lock partial-cleanup retry failed (error=${firstError?.message}, attempts=${removeAttempts})`);
    }
  } catch (err) {
    fail(`tracker lock partial-cleanup test crashed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await testTrackerLockReleaseRetriesPartialCleanup();

async function testTrackerLockReleasePreservesReplacementAfterPartialCleanup() {
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
    if (owner.token === 'replacement-owner' && removeAttempts === 1) {
      pass('stale tracker lock handle preserves a replacement after partial cleanup');
    } else {
      fail(`stale tracker lock handle touched replacement (attempts=${removeAttempts})`);
    }
  } catch (err) {
    fail(`tracker lock replacement test crashed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await testTrackerLockReleasePreservesReplacementAfterPartialCleanup();

async function testTrackerTransactionCloseReportsCleanupFailure() {
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

    if (readFileSync(tracker, 'utf-8') === 'after'
        && closeError?.message === 'injected cleanup failure'
        && repeatedCloseError === closeError
        && rejectedClosedRead
        && warning.includes('lock cleanup failed')) {
      pass('tracker transaction close preserves completed writes and reports cleanup failure');
    } else {
      fail(`tracker transaction close lost cleanup state (warning=${JSON.stringify(warning)})`);
    }
  } catch (err) {
    fail(`tracker transaction close test crashed: ${err.message}`);
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
}

await testTrackerTransactionCloseReportsCleanupFailure();

async function testReplyWatchConflictingRecommendations() {
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
    const child = spawn(NODE, [join(ROOT, 'reply-watch.mjs'), candidatesPath], {
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
    let result = await Promise.race([closePromise, sleep(3_000).then(() => null)]);
    if (result === null) {
      child.kill('SIGKILL');
      result = await closePromise;
    }
    const output = `${stdout}${stderr}`;
    if (result.code === 0 && readFileSync(tracker, 'utf-8') === initial
        && output.includes('Conflicting status recommendations')
        && output.includes('Interview') && output.includes('Rejected')) {
      pass('reply-watch surfaces conflicting replies without applying an arbitrary last status');
    } else {
      fail(`reply-watch conflict handling failed (exit=${result.code})\n${output}\n${readFileSync(tracker, 'utf-8')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await testReplyWatchConflictingRecommendations();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
