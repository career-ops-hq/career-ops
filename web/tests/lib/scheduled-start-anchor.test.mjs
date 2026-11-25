import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueDueJobs, nextFutureRun } from '../../scripts/scheduled-jobs-runner.mjs';

function storeFor(startAt, every = 1, unit = 'days', timezone = 'America/Toronto') {
  return { jobs: [{ id: '11111111-1111-4111-8111-111111111111', status: 'active',
    startAt, nextRunAt: startAt, every, unit, timezone }], queue: [], runs: [] };
}

test('daily jobs return to their original local time after a DST gap', () => {
  const store = storeFor('2026-03-07T02:30:00-05:00');
  enqueueDueJobs(store, Date.parse('2026-03-07T07:30:00Z'));
  assert.equal(store.jobs[0].nextRunAt, '2026-03-08T07:30:00.000Z');
  store.queue = [];
  enqueueDueJobs(store, Date.parse('2026-03-08T07:30:00Z'));
  assert.equal(store.jobs[0].nextRunAt, '2026-03-09T06:30:00.000Z');
  store.queue = [];
  enqueueDueJobs(store, Date.parse('2026-03-09T06:30:00Z'));
  assert.equal(store.jobs[0].nextRunAt, '2026-03-10T06:30:00.000Z');
});

test('multi-day jobs retain their original phase after a DST gap', () => {
  const store = storeFor('2026-03-06T02:30:00-05:00', 2);
  enqueueDueJobs(store, Date.parse('2026-03-06T07:30:00Z'));
  assert.equal(store.jobs[0].nextRunAt, '2026-03-08T07:30:00.000Z');
  store.queue = [];
  enqueueDueJobs(store, Date.parse('2026-03-08T07:30:00Z'));
  assert.equal(store.jobs[0].nextRunAt, '2026-03-10T06:30:00.000Z');
});

for (const [every, unit] of [[1, 'hours'], [15, 'minutes']]) {
  test(`${unit} jobs still advance to the next future occurrence when delayed`, () => {
    const store = storeFor('2026-03-07T02:30:00-05:00', every, unit);
    const now = Date.parse('2026-03-08T08:17:00Z');
    enqueueDueJobs(store, now);
    assert.equal(store.jobs[0].nextRunAt, nextFutureRun(store.jobs[0].startAt, every, unit, now, 'America/Toronto'));
    assert.ok(Date.parse(store.jobs[0].nextRunAt) > now);
    assert.equal(store.queue.length, 1);
  });
}

test('future and paused jobs are not enqueued or rescheduled', () => {
  const store = storeFor('2026-03-10T02:30:00-04:00');
  assert.equal(enqueueDueJobs(store, Date.parse('2026-03-09T06:30:00Z')), 0);
  assert.equal(store.jobs[0].nextRunAt, store.jobs[0].startAt);
  store.jobs[0].status = 'paused';
  assert.equal(enqueueDueJobs(store, Date.parse('2026-03-11T06:30:00Z')), 0);
  assert.equal(store.jobs[0].nextRunAt, store.jobs[0].startAt);
});
