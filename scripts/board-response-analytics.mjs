#!/usr/bin/env node
/**
 * Board Response Analytics Helper (#2886)
 * Calculates response latency and stage conversion rates from job tracking data.
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    json: { type: 'boolean', default: false },
    markdown: { type: 'boolean', default: false },
    'min-samples': { type: 'string', default: '1' },
  },
  allowPositionals: true,
});

export function calculateAnalytics(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return { total: 0, latencies: { mean: 0, median: 0, p90: 0 }, conversionRate: 0 };
  }

  const latencies = events
    .filter(e => e.appliedAt && e.respondedAt)
    .map(e => (new Date(e.respondedAt) - new Date(e.appliedAt)) / (1000 * 60 * 60 * 24))
    .sort((a, b) => a - b);

  if (latencies.length === 0) {
    return { total: events.length, latencies: { mean: 0, median: 0, p90: 0 }, conversionRate: 0 };
  }

  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const mean = sum / latencies.length;
  const median = latencies[Math.floor(latencies.length / 2)];
  const p90 = latencies[Math.floor(latencies.length * 0.9)];
  const offers = events.filter(e => e.stage === 'offer').length;

  return {
    total: events.length,
    latencies: { mean: Math.round(mean * 10) / 10, median: Math.round(median * 10) / 10, p90: Math.round(p90 * 10) / 10 },
    conversionRate: Math.round((offers / events.length) * 1000) / 10,
  };
}

if (process.argv[1] && process.argv[1].endsWith('board-response-analytics.mjs')) {
  const result = calculateAnalytics([]);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Board Response Analytics (Total: ${result.total})`);
    console.log(`Mean Latency: ${result.latencies.mean} days`);
  }
}
