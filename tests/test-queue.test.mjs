// tests/test-queue.test.mjs — full test-all.mjs runs take turns (lib/test-queue.mjs).
//
// Each case points the queue at a lock of its own, so it never waits behind (or
// holds up) a real full run in another session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { holdTestQueue } from '../lib/test-queue.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QUEUE = pathToFileURL(join(ROOT, 'lib', 'test-queue.mjs')).href;

/**
 * A process that holds the queue until the case calls release(), logging when
 * it held it. With `nested`, once it holds the queue it starts a child of its
 * own that asks for the queue too, the way a suite inside a full run starts a
 * test-all of its own, and reports how that child fared.
 */
function holder(lockDir, { nested = false } = {}) {
  // The nested child gives up quickly rather than waiting out the default hour:
  // if it ever queues behind its parent, that is the failure being tested.
  const nestedScript = `
    import { holdTestQueue } from ${JSON.stringify(QUEUE)};
    console.log('NESTED ' + JSON.stringify(await holdTestQueue({ holderTimeoutMs: 2_000, retryMs: 20 })));
  `;
  const script = `
    import { spawnSync } from 'node:child_process';
    import { holdTestQueue } from ${JSON.stringify(QUEUE)};
    await holdTestQueue({ retryMs: 20 });
    console.log('HELD ' + Date.now());
    if (${nested}) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(nestedScript)}], { encoding: 'utf-8' });
      console.log(r.stdout + r.stderr + 'NESTED-EXIT ' + r.status);
    }
    await new Promise((resolve) => process.stdin.once('data', resolve));
    console.log('DONE ' + Date.now());
    process.stdin.destroy(); // the only handle left, so the child ends here
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CAREER_OPS_TEST_QUEUE: '', CAREER_OPS_TEST_QUEUE_LOCK: lockDir },
  });
  let out = '';
  const watchers = [];
  const check = () => {
    for (const w of watchers) if (w.re.test(out)) w.resolve();
  };
  child.stdout.on('data', (d) => { out += d; check(); });
  child.stderr.on('data', (d) => { out += d; check(); });
  const closed = new Promise((resolve) => child.on('close', (status) => resolve(status)));
  // Resolves once the child has printed `re`. A child that exits first fails
  // the case waiting on it, with its own output, rather than leave that case
  // waiting for a line that never comes.
  const saw = (re, what) => {
    const p = new Promise((resolve, reject) => {
      watchers.push({ re, resolve });
      check();
      closed.then((status) => reject(new Error(`holder exited (${status}) before it ${what}:\n${out}`)));
    });
    // Settled by whichever case awaits it; one that never does still learns of
    // a failed child from `done`'s exit status.
    p.catch(() => {});
    return p;
  };
  return {
    child,
    saw,
    held: saw(/HELD /, 'held the queue'),
    waiting: saw(/holds the queue/, 'reported waiting for the queue'),
    done: closed.then((status) => ({ status, out })),
    release: () => child.stdin.write('release\n'),
  };
}

const span = (out) => ({
  start: Number(/HELD (\d+)/.exec(out)?.[1]),
  end: Number(/DONE (\d+)/.exec(out)?.[1]),
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-test-queue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'queue.lock');
}

test('a second full run waits until the first has finished', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir);
  await first.held;
  const second = holder(lockDir);
  // Released only once the second run is known to be waiting, so the case
  // cannot pass by the second run simply starting late.
  await second.waiting;
  first.release();
  second.release();
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.status, 0, a.out);
  assert.equal(b.status, 0, b.out);
  assert.ok(span(b.out).start >= span(a.out).end, `runs overlapped:\n${a.out}\n${b.out}`);
  assert.match(b.out, /another full test-all\.mjs run holds the queue \(pid \d+ in /);
  assert.match(b.out, /test queue free after \d+s/);
  assert.doesNotMatch(a.out, /holds the queue/, 'the first run had nothing to wait for');
});

test('a killed holder does not wedge the queue', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir);
  await first.held;
  first.child.kill('SIGKILL');
  await first.done;
  const startedAt = Date.now();
  const next = holder(lockDir);
  next.release();
  const second = await next.done;
  assert.equal(second.status, 0, second.out);
  assert.ok(Date.now() - startedAt < 20_000, 'the dead holder was reclaimed, not waited out');
});

test('CAREER_OPS_TEST_QUEUE=0 runs without the queue', async (t) => {
  const lockDir = scratch(t);
  const env = { CAREER_OPS_TEST_QUEUE: '0', CAREER_OPS_TEST_QUEUE_LOCK: lockDir };
  assert.equal(await holdTestQueue({ env }), null);
  assert.equal(existsSync(lockDir), false);
});

test('the holder turns the queue off for what it starts, so a nested test-all does not wait for its parent', async (t) => {
  const lockDir = scratch(t);
  // The nested child is started by the holder itself, so all it has to go on
  // is the environment the holder passes down.
  const first = holder(lockDir, { nested: true });
  t.after(() => first.child.kill());
  await first.saw(/NESTED-EXIT/, 'finished its nested run');
  first.release();
  const a = await first.done;
  assert.equal(a.status, 0, a.out);
  // null: the nested run did not queue at all, and it finished while its
  // parent still held the queue (it would have timed out waiting otherwise).
  assert.match(a.out, /NESTED null\s+NESTED-EXIT 0/, a.out);
  assert.doesNotMatch(a.out, /holds the queue/);

  const env = { CAREER_OPS_TEST_QUEUE_LOCK: join(dirname(lockDir), 'own.lock') };
  const held = await holdTestQueue({ env });
  assert.ok(held);
  assert.equal(env.CAREER_OPS_TEST_QUEUE, '0');
});

test('a holder that never lets go ends the wait with a message naming it', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir);
  t.after(() => first.child.kill());
  await first.held;
  const lines = [];
  await assert.rejects(
    holdTestQueue({
      env: { CAREER_OPS_TEST_QUEUE_LOCK: lockDir },
      log: (l) => lines.push(l),
      holderTimeoutMs: 300,
      retryMs: 20,
    }),
    (err) => /gave up after \d+ min waiting for the test queue/.test(err.message)
      && err.message.includes(`pid ${first.child.pid}`)
      && err.message.includes('CAREER_OPS_TEST_QUEUE=0'),
  );
  assert.equal(lines.length, 1);
});

test('a lock left by a run that no longer exists is taken over at once', async (t) => {
  const lockDir = scratch(t);
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 2 ** 30, started_at: new Date(0).toISOString() }));
  const env = { CAREER_OPS_TEST_QUEUE_LOCK: lockDir };
  const held = await holdTestQueue({ env, log: () => {} });
  assert.ok(held);
  const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  assert.equal(owner.pid, process.pid);
});
