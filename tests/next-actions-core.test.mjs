import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  createActionsContext, readActions, importActions, updateAction, listActions,
} from '../next-actions-core.mjs';
import {
  NOW, LATER, REPO, fixture, proposal, createTask, openTask, mutate,
  expectCode, storeBytes, protectedBytes, assertProtected, cli,
} from './fixtures/next-actions/helpers.mjs';

test('empty reads and valid or invalid dry-runs leave an absent data directory absent', async (t) => {
  const { root, context, store } = fixture(t, { tracker: false });
  assert.deepEqual(readActions(context), { schemaVersion: 1, tasks: [] });
  assert.equal(listActions(context, { now: NOW }).counts.total, 0);
  const preview = await importActions(context, [proposal('preview')], { dryRun: true, now: NOW });
  assert.equal(preview.created.length, 1);
  assert.equal(preview.created[0].state, 'proposed');
  await expectCode(() => importActions(context, [proposal('invalid', { title: '' })], { dryRun: true, now: NOW }), 'VALIDATION');
  assert.equal(existsSync(store), false);
  assert.equal(existsSync(join(root, 'data')), false);
});

test('reordered multi-action imports and rebind retain identity rather than using array ordinal or tracker binding', async (t) => {
  const { context, store } = fixture(t);
  const alpha = proposal('alpha');
  const beta = proposal('beta', { title: alpha.title });
  const initial = await importActions(context, [alpha, beta, structuredClone(alpha)], { now: NOW });
  assert.equal(initial.created.length, 2);
  let task = initial.created.find((item) => item.source.actionKey === 'alpha');
  task = await mutate(context, task, 'accept');
  task = await mutate(context, task, 'bind', { trackerId: '101' });
  task = await mutate(context, task, 'bind', { trackerId: '103' });
  task = await mutate(context, task, 'done', {}, LATER);
  const before = storeBytes(store);
  const result = await importActions(context, [beta, alpha], { now: LATER });
  assert.equal(result.created.length, 0);
  assert.deepEqual(new Set(result.unchanged.map((item) => item.id)), new Set(initial.created.map((item) => item.id)));
  assert.deepEqual(storeBytes(store), before);
  const retained = readActions(context).tasks.find((item) => item.id === task.id);
  assert.equal(retained.application.trackerId, '103');
  assert.equal(retained.state, 'done');
  assert.equal(retained.revision, task.revision);
});

test('changed source conflicts atomically, then acknowledgement makes old and corrected inputs retryable without losing user edits', async (t) => {
  const { context, store } = fixture(t);
  const input = proposal('correction');
  let task = await openTask(context, input);
  task = await mutate(context, task, 'edit', { patch: { title: 'User-selected wording', actor: 'company' } });
  task = await mutate(context, task, 'done', {}, LATER);
  const changed = { ...input, title: 'Corrected source wording', actor: 'unknown' };
  const before = storeBytes(store);
  await expectCode(() => importActions(context, [proposal('new-first'), changed], { now: LATER }), 'CONFLICT');
  assert.deepEqual(storeBytes(store), before, 'a conflict must not partially import earlier rows');
  task = await mutate(context, task, 'ack-source', { proposal: changed }, LATER);
  assert.equal(task.state, 'done');
  assert.equal(task.title, 'User-selected wording');
  assert.equal(task.actor, 'company');
  assert.equal(task.acknowledgedImports.length, 1);
  assert.equal(task.imported.title, input.title);
  const acknowledged = storeBytes(store);
  const retry = await importActions(context, [input, changed], { now: LATER });
  assert.equal(retry.created.length, 0);
  assert.ok(retry.unchanged.every((item) => item.id === task.id && item.state === 'done'));
  assert.deepEqual(storeBytes(store), acknowledged);
  const known = await mutate(context, task, 'ack-source', { proposal: changed }, LATER);
  assert.equal(known.revision, task.revision);
  assert.deepEqual(storeBytes(store), acknowledged);
  await expectCode(() => mutate(context, task, 'ack-source', { proposal: proposal('different-source') }, LATER), 'VALIDATION');
  assert.deepEqual(storeBytes(store), acknowledged);
});

test('canonical defaults and JSON property order normalize while a genuinely new event creates another task', async (t) => {
  const { context, store } = fixture(t);
  const input = { source: { namespace: 'manual', eventId: 'event-one', actionKey: 'form' }, title: 'Complete form', evidence: { text: 'Reviewed' } };
  const first = await createTask(context, input);
  const before = storeBytes(store);
  const retry = await importActions(context, [{
    links: [], employerDue: { text: '', kind: 'unknown' }, actor: 'unknown',
    evidence: { ref: null, text: 'Reviewed' }, title: 'Complete form',
    source: { actionKey: 'form', eventId: 'event-one', namespace: 'manual' },
  }], { now: LATER });
  assert.deepEqual(retry.unchanged.map((task) => task.id), [first.id]);
  assert.deepEqual(storeBytes(store), before);
  const second = await createTask(context, { ...input, source: { ...input.source, eventId: 'event-two' } });
  assert.notEqual(second.id, first.id);
  assert.equal(readActions(context).tasks.length, 2);
});

test('lifecycle and optimistic revision guards reject stale or implicit transitions without writing', async (t) => {
  const { context, store } = fixture(t);
  let task = await createTask(context);
  let before = storeBytes(store);
  await expectCode(() => mutate(context, task, 'done'), 'VALIDATION');
  assert.deepEqual(storeBytes(store), before);
  const proposedRevision = task.revision;
  task = await mutate(context, task, 'accept');
  before = storeBytes(store);
  await expectCode(() => updateAction(context, task.id, {
    operation: 'edit', expectedRevision: proposedRevision, reason: 'Stale reviewed edit.', patch: { title: 'Stale title' },
  }, { now: NOW }), 'CONFLICT');
  assert.deepEqual(storeBytes(store), before);
  task = await mutate(context, task, 'dismiss');
  before = storeBytes(store);
  await expectCode(() => mutate(context, task, 'edit', { patch: { title: 'No implicit reopen' } }), 'VALIDATION');
  assert.deepEqual(storeBytes(store), before);
  task = await mutate(context, task, 'reopen');
  assert.equal(task.state, 'proposed');
  await expectCode(() => mutate(context, task, 'done'), 'VALIDATION');
  task = await mutate(context, task, 'accept');
  task = await mutate(context, task, 'done');
  assert.equal(task.state, 'done');
});

const invalidProposals = [
  ['unknown proposal keys', (input) => ({ ...input, application: { trackerId: '101' } })],
  ['unknown actor', (input) => ({ ...input, actor: 'recruiter' })],
  ['empty source key', (input) => ({ ...input, source: { ...input.source, actionKey: '' } })],
  ['source control character', (input) => ({ ...input, source: { ...input.source, eventId: 'event\nsecond' } })],
  ['overlong title', (input) => ({ ...input, title: 'x'.repeat(241) })],
  ['impossible calendar date', (input) => ({ ...input, employerDue: { kind: 'date', date: '2030-02-30', timeZone: 'UTC', text: 'Stated date.' } })],
  ['unknown timezone', (input) => ({ ...input, employerDue: { kind: 'date', date: '2030-03-02', timeZone: 'Mars/Olympus', text: 'Stated date.' } })],
  ['instant without offset', (input) => ({ ...input, employerDue: { kind: 'instant', at: '2030-03-02T09:00:00', text: 'Stated instant.' } })],
  ['instant with impossible offset', (input) => ({ ...input, employerDue: { kind: 'instant', at: '2030-03-02T09:00:00+25:00', text: 'Stated instant.' } })],
  ['date without supporting text', (input) => ({ ...input, employerDue: { kind: 'date', date: '2030-03-02', timeZone: null, text: '' } })],
  ['URL userinfo', (input) => ({ ...input, links: [{ label: 'Form', ref: 'https://user:fictional@example.test/form' }] })],
  ['script URL', (input) => ({ ...input, links: [{ label: 'Form', ref: 'javascript:alert(1)' }] })],
  ['absolute local path', (input) => ({ ...input, links: [{ label: 'File', ref: 'local:/etc/passwd' }] })],
  ['local traversal', (input) => ({ ...input, links: [{ label: 'File', ref: 'local:../../outside.txt' }] })],
  ['local backslash traversal', (input) => ({ ...input, links: [{ label: 'File', ref: 'local:..\\outside.txt' }] })],
];
for (const [label, invalid] of invalidProposals) {
  test(`invalid input rejects ${label} before touching existing bytes`, async (t) => {
    const { context, store } = fixture(t);
    await createTask(context);
    const before = storeBytes(store);
    await expectCode(() => importActions(context, [proposal('valid-first'), invalid(proposal('invalid-second'))], { now: NOW }), 'VALIDATION');
    assert.deepEqual(storeBytes(store), before);
  });
}

const corruptions = [
  ['unknown version', (store) => { store.schemaVersion = 2; }],
  ['unknown store field', (store) => { store.unrecognized = true; }],
  ['initial snapshot differs from imported', (store) => { store.tasks[0].history[0].after.title = 'Different initial title'; }],
  ['illegal initial lifecycle state', (store) => { store.tasks[0].history[0].after.state = 'done'; }],
  ['acknowledged source belongs to another event', (store) => {
    const other = structuredClone(store.tasks[0].imported); other.source.eventId = 'wrong-event';
    store.tasks[0].acknowledgedImports = [other];
    store.tasks[0].history.at(-1).after.acknowledgedImports = [structuredClone(other)];
  }],
  ['duplicate UUID', (store) => { store.tasks.push(structuredClone(store.tasks[0])); }],
  ['duplicate source tuple with another UUID', (store) => { const copy = structuredClone(store.tasks[0]); copy.id = '11111111-1111-4111-8111-111111111111'; store.tasks.push(copy); }],
  ['invalid UUID', (store) => { store.tasks[0].id = 'not-a-uuid'; }],
  ['skipped history revision', (store) => { store.tasks[0].history[1].revision = 8; }],
  ['current state differs from final snapshot', (store) => { store.tasks[0].title = 'Unrecorded change'; }],
  ['invalid intermediate snapshot', (store) => { store.tasks[0].history[0].after.actor = 'invalid'; }],
  ['updated timestamp differs from history', (store) => { store.tasks[0].updatedAt = '2030-04-01T00:00:00.000Z'; }],
  ['source differs from imported', (store) => { store.tasks[0].source.eventId = 'replacement-source'; }],
];
for (const [label, corrupt] of corruptions) {
  test(`corrupt store fails closed for ${label} and never repairs itself`, async (t) => {
    const { context, store } = fixture(t);
    await openTask(context);
    const broken = JSON.parse(readFileSync(store, 'utf8'));
    corrupt(broken);
    writeFileSync(store, `${JSON.stringify(broken)}\n`);
    const before = storeBytes(store);
    assert.throws(() => readActions(context), { code: 'STORE_INVALID' });
    await expectCode(() => importActions(context, [proposal('recovery-is-forbidden')], { now: NOW }), 'STORE_INVALID');
    assert.deepEqual(storeBytes(store), before);
  });
}

test('malformed JSON and oversized stores fail closed; excessive proposal batches do not write', async (t) => {
  const { context, store } = fixture(t);
  writeFileSync(store, '{broken');
  const malformed = storeBytes(store);
  await expectCode(() => importActions(context, [proposal('first')], { now: NOW }), 'STORE_INVALID');
  assert.deepEqual(storeBytes(store), malformed);
  writeFileSync(store, ' '.repeat(16 * 1024 * 1024 + 1));
  const oversized = storeBytes(store);
  assert.throws(() => readActions(context), { code: 'STORE_INVALID' });
  assert.deepEqual(storeBytes(store), oversized);
  unlinkSync(store);
  await expectCode(() => importActions(context, Array.from({ length: 501 }, (_, index) => proposal(`item-${index}`)), { now: NOW }), 'VALIDATION');
  assert.equal(existsSync(store), false);
});

test('invalid UTF-8 store bytes are not accepted through replacement-character decoding', async (t) => {
  const { context, store } = fixture(t);
  await openTask(context, proposal('utf8-probe', { title: 'UTF8_TITLE_MARKER' }));
  const source = readFileSync(store);
  const offset = source.indexOf('UTF8_TITLE_MARKER');
  assert.ok(offset >= 0);
  source[offset] = 0xff;
  writeFileSync(store, source);
  assert.throws(() => readActions(context), { code: 'STORE_INVALID' });
  await expectCode(() => importActions(context, [proposal('another')], { now: NOW }), 'STORE_INVALID');
  assert.deepEqual(storeBytes(store), source);
});

test('an otherwise individually valid batch exceeding the import byte limit is rejected before creating a store', async (t) => {
  const { context, store } = fixture(t, { tracker: false });
  const batch = Array.from({ length: 500 }, (_, index) => proposal(`large-${index}`, {
    title: 'T'.repeat(240), evidence: { text: 'E'.repeat(2000), ref: null },
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(batch)) > 1024 * 1024);
  await expectCode(() => importActions(context, batch, { now: NOW }), 'VALIDATION');
  assert.equal(existsSync(store), false);
});

test('deadline, personal target, snooze and unknown timezone stay independent in list projection', async (t) => {
  const { context, store } = fixture(t);
  let task = await openTask(context, proposal('timing', {
    employerDue: { kind: 'date', date: '2030-03-05', timeZone: 'UTC', text: 'Employer stated March 5.' },
  }));
  task = await mutate(context, task, 'edit', { patch: {
    targetDate: { date: '2030-03-01', timeZone: 'UTC' }, snoozedUntil: '2030-03-06T09:00:00Z',
  } });
  const before = storeBytes(store);
  const past = listActions(context, { now: LATER }).tasks.find((item) => item.id === task.id);
  assert.equal(past.flags.targetReached, true);
  assert.equal(past.flags.targetPast, true);
  assert.equal(past.flags.requestedSnoozeActive, true);
  assert.equal(past.flags.snoozePastEmployerDue, true);
  assert.equal(past.flags.snoozeOverridden, true);
  assert.notEqual(past.bucket, 'snoozed');
  assert.equal(past.employerDue.date, '2030-03-05');
  assert.equal(past.targetDate.date, '2030-03-01');
  assert.equal(past.snoozedUntil, '2030-03-06T09:00:00.000Z');
  assert.deepEqual(storeBytes(store), before, 'list does not write when a target becomes past');
  const zoneless = await openTask(context, proposal('zone-unknown', {
    employerDue: { kind: 'date', date: '2030-02-01', timeZone: null, text: 'A date was stated without a timezone.' },
  }));
  const unknown = listActions(context, { now: LATER }).tasks.find((item) => item.id === zoneless.id);
  assert.equal(unknown.flags.employerTimeZoneUnknown, true);
  assert.equal(unknown.flags.employerOverdue, false);
  assert.equal(unknown.flags.employerDueToday, false);
});

test('instant due-today uses the explicit list timezone and default UTC, while overdue stays visible in needs-review', async (t) => {
  const { context } = fixture(t);
  const task = await createTask(context, proposal('instant', {
    employerDue: { kind: 'instant', at: '2030-03-02T01:00:00Z', text: 'Employer provided an exact deadline.' },
  }));
  const now = new Date('2030-03-01T20:00:00Z');
  const utc = listActions(context, { now });
  const pacific = listActions(context, { now, timeZone: 'America/Los_Angeles' });
  assert.equal(utc.timeZone, 'UTC');
  assert.equal(utc.tasks[0].flags.employerDueToday, false);
  assert.equal(pacific.timeZone, 'America/Los_Angeles');
  assert.equal(pacific.tasks[0].flags.employerDueToday, true);
  const late = listActions(context, { now: LATER });
  assert.deepEqual(late.groups['needs-review'], [task.id]);
  assert.equal(late.tasks[0].flags.employerOverdue, true);
});

test('snoozed and unknown items are never omitted; expiry changes projection without writing', async (t) => {
  const { context, store } = fixture(t);
  let snoozed = await openTask(context, proposal('snoozed'));
  snoozed = await mutate(context, snoozed, 'edit', { patch: { snoozedUntil: '2030-03-02T08:00:00Z' } });
  const uncertain = await openTask(context, proposal('uncertain', { actor: 'unknown' }));
  const before = storeBytes(store);
  const current = listActions(context, { now: NOW });
  assert.equal(current.counts.total, 2);
  assert.deepEqual(current.groups.snoozed, [snoozed.id]);
  assert.deepEqual(current.groups['needs-review'], [uncertain.id]);
  const later = listActions(context, { now: LATER });
  assert.ok(later.groups.ready.includes(snoozed.id));
  assert.equal(later.tasks.find((item) => item.id === snoozed.id).snoozedUntil, '2030-03-02T08:00:00.000Z');
  assert.deepEqual(storeBytes(store), before);
});

test('binding uses strict original digit cells and detects posting changes without rewriting other user files', async (t) => {
  const { root, context, store } = fixture(t);
  const tracker = join(root, 'data/applications.md');
  const original = readFileSync(tracker, 'utf8');
  const largeId = '9007199254740993';
  writeFileSync(tracker, original.replace('| 101 |', `| 00${largeId} |`));
  const before = protectedBytes(root);
  let task = await openTask(context);
  task = await mutate(context, task, 'bind', { trackerId: largeId });
  assert.equal(task.application.trackerId, largeId);
  assert.equal(task.application.report, '[101](../reports/101-acme.md)');
  assert.equal(task.application.postingUrl, 'https://jobs.example.test/acme/A-101');
  assert.equal(listActions(context, { now: NOW }).tasks[0].flags.bindingState, 'current');
  assertProtected(root, before);
  writeFileSync(tracker, readFileSync(tracker, 'utf8').replace('https://jobs.example.test/acme/A-101', 'https://jobs.example.test/acme/A-999'));
  const actionBytes = storeBytes(store);
  const changed = listActions(context, { now: NOW }).tasks[0];
  assert.equal(changed.flags.bindingState, 'changed');
  assert.equal(changed.bucket, 'needs-review');
  assert.deepEqual(storeBytes(store), actionBytes);
});

for (const invalidId of ['101x', '1e2', '101.0', '-101']) {
  test(`bind rejects malformed raw tracker ID ${invalidId}`, async (t) => {
    const { root, context, store } = fixture(t);
    const tracker = join(root, 'data/applications.md');
    writeFileSync(tracker, readFileSync(tracker, 'utf8').replace('| 101 |', `| ${invalidId} |`));
    const task = await openTask(context);
    const before = storeBytes(store);
    await expectCode(() => mutate(context, task, 'bind', { trackerId: '101' }), 'VALIDATION');
    assert.deepEqual(storeBytes(store), before);
  });
}

test('duplicate tracker IDs reject bind rather than selecting a row by parse order', async (t) => {
  const { root, context, store } = fixture(t);
  const tracker = join(root, 'data/applications.md');
  writeFileSync(tracker, readFileSync(tracker, 'utf8').replace('| 103 |', '| 101 |'));
  const task = await openTask(context);
  const before = storeBytes(store);
  await expectCode(() => mutate(context, task, 'bind', { trackerId: '101' }), 'VALIDATION');
  assert.deepEqual(storeBytes(store), before);
});

test('limited bindings and switched trackers remain visible with honest evidence flags', async (t) => {
  const { root, context, store } = fixture(t);
  const tracker = join(root, 'data/applications.md');
  writeFileSync(tracker, readFileSync(tracker, 'utf8').replace('[101](../reports/101-acme.md)', '—').replace('https://jobs.example.test/acme/A-101', ''));
  let task = await openTask(context);
  task = await mutate(context, task, 'bind', { trackerId: '101' });
  assert.equal(listActions(context, { now: NOW }).tasks[0].flags.bindingLimited, true);
  const replacement = join(root, 'alternate.md');
  writeFileSync(replacement, readFileSync(tracker));
  const switched = createActionsContext({ dataRoot: root, codeRoot: REPO, trackerPath: replacement });
  const before = storeBytes(store);
  const result = listActions(switched, { now: NOW });
  assert.equal(result.tasks[0].flags.bindingState, 'other-tracker');
  assert.ok(result.groups['needs-review'].includes(task.id));
  assert.deepEqual(storeBytes(store), before);
});

test('an unavailable external tracker leaves standalone actions usable and bound actions reviewable', async (t) => {
  const { root, context, store } = fixture(t);
  const protectedBefore = protectedBytes(root);
  const externalDir = join(root, 'external-tracker');
  mkdirSync(externalDir);
  const externalPath = join(externalDir, 'applications.md');
  writeFileSync(externalPath, readFileSync(context.trackerPath));
  const externalContext = createActionsContext({ dataRoot: root, codeRoot: REPO, trackerPath: externalPath });
  let bound = await openTask(externalContext, proposal('bound-external'));
  bound = await mutate(externalContext, bound, 'bind', { trackerId: '101' });
  const standalone = await openTask(externalContext, proposal('standalone'));

  // ENOTDIR reproduces loss of tracker access on Windows and POSIX without
  // depending on whether chmod binds an elevated test process.
  renameSync(externalDir, join(root, 'external-backup'));
  writeFileSync(externalDir, 'The external tracker directory is unavailable.');
  const offlineContext = createActionsContext({ dataRoot: root, codeRoot: REPO, trackerPath: externalPath });
  const originalStore = storeBytes(store);
  const list = listActions(offlineContext, { now: NOW });
  const unavailable = list.tasks.find((task) => task.id === bound.id);
  assert.equal(unavailable.flags.bindingState, 'tracker-unavailable');
  assert.equal(unavailable.bucket, 'needs-review');
  assert.equal(list.tasks.find((task) => task.id === standalone.id).bucket, 'ready');
  assert.equal(readActions(offlineContext).tasks.find((task) => task.id === bound.id).title, bound.title);
  assert.deepEqual(storeBytes(store), originalStore, 'list/show do not repair or replace inaccessible references');

  await expectCode(() => mutate(offlineContext, standalone, 'bind', { trackerId: '101' }), 'IO');
  assert.deepEqual(storeBytes(store), originalStore, 'a failed explicit bind must preserve all action bytes');
  const added = await createTask(offlineContext, proposal('added-while-tracker-offline'));
  assert.equal(added.state, 'proposed');
  const run = (args) => {
    const result = cli(root, args, { env: { CAREER_OPS_TRACKER: externalPath } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run(['list']).tasks.find((task) => task.id === standalone.id).bucket, 'ready');
  assert.equal(run(['show', bound.id]).title, bound.title);
  assert.equal(run(['add', 'Offline manual action', '--key', 'offline-cli', '--evidence', 'The user explicitly asked.']).created.length, 1);
  const completed = run(['done', bound.id, '--revision', String(bound.revision), '--reason', 'The user confirmed completion.']);
  assert.equal(completed.state, 'done', 'a user can record completion without tracker availability');
  assert.equal(readActions(offlineContext).tasks.length, 4);
  assertProtected(root, protectedBefore);
});

test('saved absolute tracker references from either OS remain readable and can be explicitly unbound', async (t) => {
  const { context, store } = fixture(t);
  let task = await openTask(context, proposal('portable-binding'));
  task = await mutate(context, task, 'bind', { trackerId: '101' });
  const original = JSON.parse(readFileSync(store, 'utf8'));
  for (const foreignPath of ['C:\\career-data\\applications.md', '/foreign-career-data/applications.md']) {
    // These are valid snapshots produced on the named OS; changing every
    // binding occurrence preserves the same current/history agreement.
    const moved = structuredClone(original);
    moved.tasks[0].application.trackerPath = foreignPath;
    for (const revision of moved.tasks[0].history) {
      if (revision.after.application) revision.after.application.trackerPath = foreignPath;
    }
    writeFileSync(store, JSON.stringify(moved, null, 2) + '\n');
    const before = storeBytes(store);
    const saved = readActions(context).tasks[0];
    assert.equal(saved.application.trackerPath, foreignPath);
    const listed = listActions(context, { now: NOW }).tasks[0];
    assert.equal(listed.flags.bindingState, 'other-tracker');
    assert.equal(listed.bucket, 'needs-review');
    assert.deepEqual(storeBytes(store), before);
    const unbound = await mutate(context, saved, 'unbind');
    assert.equal(unbound.application, null);
    assert.equal(readActions(context).tasks[0].history.at(-2).after.application.trackerPath, foreignPath);
  }
});

test('supported IANA aliases with digits work for list and persisted due dates without accepting numeric offsets', async (t) => {
  const { context } = fixture(t);
  for (const timeZone of ['EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT']) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone }));
    const task = await openTask(context, proposal(`iana-${timeZone}`, {
      employerDue: { kind: 'date', date: '2030-03-01', timeZone, text: 'The employer stated this timezone.' },
    }));
    const listed = listActions(context, { timeZone, now: NOW }).tasks.find((item) => item.id === task.id);
    assert.equal(listed.employerDue.timeZone, timeZone);
    assert.equal(listed.flags.employerDueToday, true);
    assert.equal(readActions(context).tasks.find((item) => item.id === task.id).employerDue.timeZone, timeZone);
  }
  for (const timeZone of ['+05:00', '-0430', 'UTC+5', 'Invalid/Zone']) {
    assert.throws(() => listActions(context, { timeZone, now: NOW }), { code: 'VALIDATION' });
  }
});

test('real-parent symlink aliases share one store; symlink store files are rejected without replacing the target', async (t) => {
  const { root, context, store } = fixture(t);
  const alias = join(root, 'alias');
  try { symlinkSync(join(root, 'data'), alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host does not permit directory symlinks.');
    throw error;
  }
  // A second DataRoot with its data directory pointing at the same real parent.
  const secondRoot = join(root, 'second');
  mkdirSync(secondRoot);
  symlinkSync(join(root, 'data'), join(secondRoot, 'data'), process.platform === 'win32' ? 'junction' : 'dir');
  const second = createActionsContext({ dataRoot: secondRoot, codeRoot: REPO });
  const imports = await Promise.all([
    importActions(context, [proposal('shared-parent')], { now: NOW }),
    importActions(second, [proposal('shared-parent')], { now: NOW }),
  ]);
  assert.equal(imports.flatMap((result) => result.created).length, 1);
  assert.equal(readActions(context).tasks.length, 1);
  const target = join(root, 'target.json');
  writeFileSync(target, readFileSync(store));
  const before = readFileSync(target);
  unlinkSync(store);
  try { symlinkSync(target, store, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host does not permit file symlinks.');
    throw error;
  }
  await assert.rejects(() => importActions(context, [proposal('must-not-write')], { now: NOW }), (error) => {
    assert.ok(['IO', 'STORE_INVALID'].includes(error.code));
    return true;
  });
  assert.deepEqual(readFileSync(target), before);
});
