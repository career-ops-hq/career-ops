import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createActionsContext, readActions, importActions, listActions } from '../next-actions-core.mjs';
import {
  CASES, CORE_URL, NOW, LATER, fixture, openTask, mutate, proposal,
  protectedBytes, assertProtected, childModule, expectCode, storeBytes,
} from './fixtures/next-actions/helpers.mjs';

// Six core workflows and two explicitly supplied observations. Fixtures are
// fictional; the core does not fetch mail, inspect portal receipts, or submit.
test('H1: two separate outreach obligations survive a real process restart', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'output/application-101-cover.txt'), 'First fictional draft.');
  writeFileSync(join(root, 'output/application-102-cover.txt'), 'Second fictional draft.');
  const imported = await importActions(context, CASES.outreach, { now: NOW });
  const tasks = await Promise.all(imported.created.map((task) => mutate(context, task, 'accept')));
  const restarted = JSON.parse(await childModule(`
    import {createActionsContext, listActions} from ${JSON.stringify(CORE_URL)};
    const [dataRoot] = process.argv.slice(1);
    const result = listActions(createActionsContext({dataRoot}),
      {now: new Date('2030-03-02T09:00:00Z')});
    process.stdout.write(JSON.stringify(result));
  `, [root]));
  assert.deepEqual(new Set(restarted.tasks.map((task) => task.id)), new Set(tasks.map((task) => task.id)));
  assert.equal(restarted.counts.total, 2);
  assert.deepEqual(new Set(restarted.groups.ready), new Set(tasks.map((task) => task.id)));
  for (const task of restarted.tasks) {
    assert.equal(task.state, 'open');
    assert.equal(task.actor, 'user');
    assert.equal(task.flags.employerDueUnknown, true);
    assert.equal(task.flags.employerOverdue, false);
  }
  assert.deepEqual(restarted.tasks.flatMap((task) => task.links.map((link) => link.ref)).sort(),
    ['local:output/application-101-cover.txt', 'local:output/application-102-cover.txt']);
  assertProtected(root, before);
});

test('H2: an interview reply remains actionable while a company-owned item remains waiting', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  let reply = await openTask(context, CASES.interviewReply);
  reply = await mutate(context, reply, 'bind', { trackerId: '102' });
  const wait = await openTask(context, CASES.companyWait);
  const result = listActions(context, { now: new Date('2030-03-31T09:00:00Z') });
  assert.ok(result.groups.ready.includes(reply.id));
  assert.ok(result.groups.waiting.includes(wait.id));
  assert.ok(!result.groups.ready.includes(wait.id));
  assert.equal(result.tasks.find((task) => task.id === reply.id).flags.employerOverdue, false);
  assert.equal(result.tasks.find((task) => task.id === wait.id).actor, 'company');
  assertProtected(root, before);
});

test('H3: yesterday personal target carries forward without becoming an employer deadline', async (t) => {
  const { root, context } = fixture(t);
  let task = await openTask(context, CASES.questionnaire);
  task = await mutate(context, task, 'edit', { patch: { targetDate: { date: '2030-03-01', timeZone: 'UTC' } } });
  const carried = listActions(context, { now: LATER }).tasks[0];
  assert.equal(carried.id, task.id);
  assert.equal(carried.flags.targetReached, true);
  assert.equal(carried.flags.targetPast, true);
  assert.equal(carried.flags.employerDueUnknown, true);
  assert.equal(carried.flags.employerOverdue, false);
  assert.equal(carried.employerDue.kind, 'unknown');
  const updated = await mutate(context, task, 'edit', {
    patch: { targetDate: { date: '2030-03-02', timeZone: 'UTC' } },
  }, LATER);
  assert.equal(updated.id, task.id);
  assert.equal(updated.createdAt, task.createdAt);
  assert.deepEqual(updated.links, task.links);
  assert.equal(readActions(createActionsContext({ dataRoot: root })).tasks.length, 1);
});

test('H4: an ownership question stays visible and needs review until an explicit company correction', async (t) => {
  const { context } = fixture(t);
  let task = await openTask(context, CASES.unclearOwner);
  const uncertain = listActions(context, { now: NOW });
  assert.deepEqual(uncertain.groups['needs-review'], [task.id]);
  assert.equal(uncertain.tasks[0].actor, 'unknown');
  task = await mutate(context, task, 'edit', { patch: { actor: 'company' } });
  const corrected = listActions(context, { now: LATER });
  assert.deepEqual(corrected.groups.waiting, [task.id]);
  assert.deepEqual(corrected.groups['needs-review'], []);
  assert.equal(corrected.tasks[0].state, 'open');
  assert.equal(task.history[task.history.length - 2].after.actor, 'unknown');
});

test('H5: one overview retains separate form and assignment links despite identical company labels', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  let form = await openTask(context, CASES.questionnaire);
  form = await mutate(context, form, 'bind', { trackerId: '101' });
  let assignment = await openTask(context, CASES.assignment);
  assignment = await mutate(context, assignment, 'bind', { trackerId: '103' });
  const wait = await openTask(context, CASES.companyWait);
  let closed = await openTask(context, proposal('old-task'));
  closed = await mutate(context, closed, 'done');
  const result = listActions(context, { now: LATER });
  assert.equal(result.counts.total, 3);
  assert.deepEqual(new Set(result.tasks.map((task) => task.id)), new Set([form.id, assignment.id, wait.id]));
  assert.equal(result.tasks.find((task) => task.id === form.id).application.trackerId, '101');
  assert.equal(result.tasks.find((task) => task.id === assignment.id).application.trackerId, '103');
  assert.deepEqual(result.tasks.find((task) => task.id === form.id).links, CASES.questionnaire.links);
  assert.deepEqual(result.tasks.find((task) => task.id === assignment.id).links, CASES.assignment.links);
  // A missing prepared file remains a reference, never a reason to drop a task.
  assert.ok(result.tasks.some((task) => task.links.some((link) => link.ref === 'local:output/recording-outline.txt')));
  assert.ok(listActions(context, { includeClosed: true, now: LATER }).groups.done.includes(closed.id));
  assertProtected(root, before);
});

test('H6: user-confirmed form completion closes only that task and old source retries never reopen it', async (t) => {
  const { root, context, store } = fixture(t);
  const before = protectedBytes(root);
  let form = await openTask(context, CASES.questionnaire);
  const notes = await openTask(context, proposal('interview-notes'));
  form = await mutate(context, form, 'done', { reason: 'The user confirmed the questionnaire is complete.' }, LATER);
  const afterDone = storeBytes(store);
  const replay = await importActions(context, [CASES.questionnaire], { now: new Date('2030-03-05T09:00:00Z') });
  assert.equal(replay.created.length, 0);
  assert.deepEqual(replay.unchanged.map((task) => [task.id, task.state, task.revision, task.updatedAt]),
    [[form.id, 'done', form.revision, form.updatedAt]]);
  assert.deepEqual(storeBytes(store), afterDone);
  await expectCode(() => mutate(context, form, 'done'), 'VALIDATION');
  assert.deepEqual(storeBytes(store), afterDone);
  assert.deepEqual(listActions(context, { now: LATER }).tasks.map((task) => task.id), [notes.id]);
  assertProtected(root, before);
});

test('I1: three manually reviewed missing-cover observations create proposals without sending or changing applications', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  const observations = ['alpha', 'beta', 'gamma'].map((event) => ({
    ...structuredClone(CASES.receiptRepair),
    source: { ...CASES.receiptRepair.source, eventId: `receipt-${event}` },
  }));
  const first = await importActions(context, observations, { now: NOW });
  assert.equal(first.created.length, 3);
  assert.ok(first.created.every((task) => task.state === 'proposed' && task.employerDue.kind === 'unknown'));
  const retry = await importActions(context, [...observations].reverse(), { now: LATER });
  assert.equal(retry.created.length, 0);
  assert.equal(retry.unchanged.length, 3);
  assert.equal(listActions(context, { now: LATER }).groups['needs-review'].length, 3);
  assertProtected(root, before);
});

test('I2: supplied bot-left-chat observations preserve two unanswered tasks and never invent a three-day deadline', async (t) => {
  const { root, context } = fixture(t);
  const before = protectedBytes(root);
  const inputs = ['alpha', 'beta'].map((event) => ({
    ...structuredClone(CASES.unavailableScreener),
    source: { ...CASES.unavailableScreener.source, eventId: `screener-${event}` },
  }));
  const imported = await importActions(context, inputs, { now: NOW });
  await Promise.all(imported.created.map((task) => mutate(context, task, 'accept')));
  const result = listActions(context, { now: new Date('2030-03-04T09:00:00Z') });
  assert.equal(result.counts.total, 2);
  assert.equal(result.groups.ready.length, 2);
  for (const task of result.tasks) {
    assert.equal(task.state, 'open');
    assert.deepEqual(task.employerDue, { kind: 'unknown', text: '' });
    assert.equal(task.flags.employerOverdue, false);
    assert.equal(task.flags.employerDueToday, false);
    assert.equal(task.targetDate, null);
  }
  assertProtected(root, before);
});
