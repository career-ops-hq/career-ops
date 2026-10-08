import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { computeProgressMetrics } from '../web/src/lib/analytics-metrics.mjs';

const states = load(readFileSync(new URL('../templates/states.yml', import.meta.url), 'utf8')).states;
const expected = {
  EVALUATED: [1, 0, 0, 0, 0], APPLIED: [1, 1, 0, 0, 0],
  RESPONDED: [1, 1, 1, 0, 0], ASSESSMENT: [1, 1, 1, 0, 0],
  INTERVIEW: [1, 1, 1, 1, 0], OFFER: [1, 1, 1, 1, 1],
  HIRED: [1, 1, 1, 1, 1], REJECTED: [1, 1, 1, 0, 0],
  DISCARDED: [1, 0, 0, 0, 0], SKIP: [1, 0, 0, 0, 0],
};

for (const state of states) {
  const key = state.label.toUpperCase();
  test(`Analytics independently classifies canonical ${state.label}`, () => {
    assert.ok(expected[key], `No contract case for ${key}`);
    const metrics = computeProgressMetrics([{ status: state.label }]);
    assert.deepEqual(metrics.funnel.map(stage => stage.count), expected[key]);
    assert.equal(metrics.activeApps, ['SKIP', 'REJECTED', 'DISCARDED'].includes(key) ? 0 : 1);
    assert.equal(metrics.totalOffers, ['OFFER', 'HIRED'].includes(key) ? 1 : 0);
  });
}
