import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acquirePipelineLock, lockDirFor } from '../pipeline-lock.mjs';
import { readActions } from '../next-actions-core.mjs';
import {
  CLI, CORE_URL, NOW, fixture, proposal, createTask, openTask,
  childModule, isolatedEnv, storeBytes, protectedBytes, assertProtected,
} from './fixtures/next-actions/helpers.mjs';

const CHILD_TIMEOUT = 10_000;
const LOCK_ENV = {
  CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '5000',
  CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '6000',
  CAREER_OPS_PIPELINE_LOCK_RETRY_MS: '10',
  CAREER_OPS_PIPELINE_LOCK_STALE_MS: '60000',
};

function runModule(root, code, args) {
  return childModule(code, args, { env: isolatedEnv(root, LOCK_ENV), timeout: CHILD_TIMEOUT });
}

function runCli(root, args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], {
      cwd: root, env: isolatedEnv(root, { ...LOCK_ENV, ...extraEnv }),
      encoding: 'utf8', timeout: CHILD_TIMEOUT, maxBuffer: 256 * 1024,
    }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
    });
  });
}

const IMPORT_CODE = `import {createActionsContext,importActions} from ${JSON.stringify(CORE_URL)};
  const [dataRoot,payload]=process.argv.slice(1);
  const result=await importActions(createActionsContext({dataRoot}),
    JSON.parse(payload),{now:new Date(${JSON.stringify(NOW.toISOString())})});
  process.stdout.write(JSON.stringify({created:result.created.map(task=>task.id),unchanged:result.unchanged.map(task=>task.id)}));`;

test('concurrent independent producers retain every imported action across process restarts', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  const code = `import {createActionsContext,importActions} from ${JSON.stringify(CORE_URL)};
    const [dataRoot,payload]=process.argv.slice(1);
    const context=createActionsContext({dataRoot});
    const inputs=JSON.parse(payload);
    const created=[];
    // Each producer preserves its own order; separate producers run concurrently.
    for(const input of inputs) {
      const result=await importActions(context,[input],{now:new Date(${JSON.stringify(NOW.toISOString())})});
      created.push(...result.created.map(task=>task.id));
    }
    process.stdout.write(JSON.stringify(created));`;
  const batches = Array.from({ length: 4 }, (_, worker) =>
    Array.from({ length: 5 }, (_, item) => proposal(`producer-${worker}-action-${item}`)));
  const results = await Promise.all(batches.map((inputs) => runModule(root, code, [root, JSON.stringify(inputs)])));
  const created = results.flatMap((output) => JSON.parse(output));
  assert.equal(created.length, 20);
  assert.equal(new Set(created).size, 20);
  const saved = readActions(context);
  assert.equal(saved.tasks.length, 20);
  assert.deepEqual(new Set(saved.tasks.map((task) => task.id)), new Set(created));
  assert.deepEqual(new Set(saved.tasks.map((task) => task.source.actionKey)), new Set(batches.flat().map((input) => input.source.actionKey)));
  assert.ok(saved.tasks.every((task) => task.revision === 1 && task.history.length === 1));
  assertProtected(root, before);
});

test('concurrent imports of one source create one task and return the same persisted UUID', async (t) => {
  const { root, context } = fixture(t);
  const input = JSON.stringify([proposal('concurrent-same-source')]);
  const outputs = await Promise.all(Array.from({ length: 3 }, () => runModule(root, IMPORT_CODE, [root, input])));
  const results = outputs.map((output) => JSON.parse(output));
  assert.equal(results.flatMap((result) => result.created).length, 1);
  assert.equal(results.flatMap((result) => result.unchanged).length, 2);
  const ids = results.flatMap((result) => [...result.created, ...result.unchanged]);
  assert.equal(new Set(ids).size, 1);
  const [saved] = readActions(context).tasks;
  assert.equal(readActions(context).tasks.length, 1);
  assert.equal(saved.id, ids[0]);
  assert.equal(saved.revision, 1);
  assert.equal(saved.state, 'proposed');
});

for (const firstOperation of ['accept', 'edit']) {
  test(`concurrent ${firstOperation}/edit commands with one revision commit exactly one reviewed change`, async (t) => {
    const { root, context } = fixture(t);
    const task = firstOperation === 'accept' ? await createTask(context) : await openTask(context);
    const commands = [
      { operation: firstOperation, ...(firstOperation === 'edit' ? { patch: { title: 'First reviewed title' } } : {}) },
      { operation: 'edit', patch: { title: 'Second reviewed title' } },
    ].map((command) => ({ ...command, expectedRevision: task.revision, reason: 'The user reviewed this fictional change.' }));
    const code = `import {createActionsContext,updateAction} from ${JSON.stringify(CORE_URL)};
      const [dataRoot,id,payload]=process.argv.slice(1);
      const command=JSON.parse(payload);
      try {
        const task=await updateAction(createActionsContext({dataRoot}),id,command,
          {now:new Date(${JSON.stringify(NOW.toISOString())})});
        process.stdout.write(JSON.stringify({ok:true,operation:command.operation,title:task.title,state:task.state,revision:task.revision}));
      } catch(error) {process.stdout.write(JSON.stringify({ok:false,code:error.code}));}`;
    const results = (await Promise.all(commands.map((command) =>
      runModule(root, code, [root, task.id, JSON.stringify(command)])))).map((output) => JSON.parse(output));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, code: 'CONFLICT' }]);
    const winner = results.find((result) => result.ok);
    const saved = readActions(context).tasks[0];
    assert.equal(saved.revision, task.revision + 1);
    assert.equal(saved.revision, winner.revision);
    assert.equal(saved.history.length, task.history.length + 1);
    assert.equal(saved.history.at(-1).operation, winner.operation);
    assert.equal(saved.title, winner.title);
    assert.equal(saved.state, winner.state);
  });
}

test('a live lock excludes CLI imports until the explicit bounded wait expires without stealing it', async (t) => {
  const { root, context, store } = fixture(t);
  await createTask(context);
  const before = storeBytes(store);
  const file = join(root, 'waiting-import.json');
  writeFileSync(file, JSON.stringify([proposal('after-held-lock')]));
  const held = await acquirePipelineLock(context.storePath);
  const lockPath = lockDirFor(context.storePath);
  let blocked;
  const started = Date.now();
  try {
    blocked = await runCli(root, ['import', '--file', file], {
      CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '5000',
      CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '150',
    });
    assert.equal(blocked.code, 4, JSON.stringify(blocked));
    assert.equal(blocked.signal, null);
    assert.equal(JSON.parse(blocked.stderr).error.code, 'LOCK_TIMEOUT');
    assert.ok(Date.now() - started < 5000, 'absolute wait ceiling must beat the 5-second per-holder timeout');
    assert.deepEqual(storeBytes(store), before);
    assert.equal(existsSync(lockPath), true, 'a timed-out contender must not remove the live owner lock');
    assert.equal(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).pid, process.pid);
  } finally { held.release(); }
  const next = await runCli(root, ['import', '--file', file]);
  assert.equal(next.code, 0, JSON.stringify(next));
  assert.equal(JSON.parse(next.stdout).created.length, 1);
  assert.equal(readActions(context).tasks.length, 2);
  assert.equal(existsSync(lockPath), false);
});

test('a failed locked batch preserves bytes, releases its lock, and permits the next real CLI write', async (t) => {
  const { root, context, store } = fixture(t);
  const existing = proposal('existing-source');
  await createTask(context, existing);
  const before = storeBytes(store);
  const protectedBefore = protectedBytes(root);
  const failedFile = join(root, 'conflicting-import.json');
  writeFileSync(failedFile, JSON.stringify([
    proposal('must-not-partially-commit'), { ...existing, title: 'Conflicting source text' },
  ]));
  const failed = await runCli(root, ['import', '--file', failedFile]);
  assert.equal(failed.code, 3, JSON.stringify(failed));
  assert.equal(JSON.parse(failed.stderr).error.code, 'CONFLICT');
  assert.deepEqual(storeBytes(store), before);
  assert.equal(existsSync(lockDirFor(context.storePath)), false, 'exception must release the store lock');
  assert.deepEqual(readdirSync(dirname(store)).filter((name) => name.startsWith('.next-actions.json.') && name.endsWith('.tmp')), []);
  const validFile = join(root, 'successful-import.json');
  writeFileSync(validFile, JSON.stringify([proposal('next-successful-write')]));
  const succeeded = await runCli(root, ['import', '--file', validFile], { CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS: '150' });
  assert.equal(succeeded.code, 0, JSON.stringify(succeeded));
  assert.equal(JSON.parse(succeeded.stdout).created.length, 1);
  assert.deepEqual(new Set(readActions(context).tasks.map((task) => task.source.actionKey)), new Set(['existing-source', 'next-successful-write']));
  assert.equal(existsSync(lockDirFor(context.storePath)), false);
  assertProtected(root, protectedBefore);
});
