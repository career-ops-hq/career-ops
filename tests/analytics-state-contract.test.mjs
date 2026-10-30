import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasWeb = existsSync(join(ROOT, 'web', 'src'));
const { computeTrackerStats } = await import('../stats.mjs');
const { computeProgressMetrics } = hasWeb ? await import('../web/src/lib/analytics-metrics.mjs') : {};

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
  test(`Analytics independently classifies canonical ${state.label}`, { skip: !hasWeb }, () => {
    assert.ok(expected[key], `No contract case for ${key}`);
    const metrics = computeProgressMetrics([{ status: state.label }]);
    assert.deepEqual(metrics.funnel.map(stage => stage.count), expected[key]);
    assert.equal(metrics.activeApps, ['APPLIED', 'RESPONDED', 'ASSESSMENT', 'INTERVIEW', 'OFFER'].includes(key) ? 1 : 0);
    assert.equal(metrics.totalOffers, ['OFFER', 'HIRED'].includes(key) ? 1 : 0);
  });
}

test('Analytics and stats.mjs count the same active applications', { skip: !hasWeb }, () => {
  const labels = states.map(state => state.label);
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...labels.map((label, i) => `| ${i + 1} | 2026-10-01 | Acme ${i} | Engineer | 4.0/5 | ${label} | | | |`),
  ].join('\n');
  const web = computeProgressMetrics(labels.map(status => ({ status }))).activeApps;
  assert.equal(computeTrackerStats(tracker).activeApps, 5);
  assert.equal(web, 5);
});
