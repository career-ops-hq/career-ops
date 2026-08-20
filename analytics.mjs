#!/usr/bin/env node

/**
 * analytics.mjs — Application Funnel Analytics & Conversion Metrics
 *
 * Computes application conversion metrics, response rates, and pipeline stage breakdowns.
 *
 * Usage:
 *   node analytics.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKER_PATH = resolve(__dirname, 'data', 'tracker.tsv');

export function computeApplicationAnalytics() {
  if (!existsSync(TRACKER_PATH)) {
    return {
      totalApplications: 0,
      submitted: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
      responseRatePct: "0.0%",
      interviewRatePct: "0.0%",
      stages: {}
    };
  }

  const raw = readFileSync(TRACKER_PATH, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));

  let submitted = 0;
  let interviews = 0;
  let offers = 0;
  let rejections = 0;
  const stages = {};

  lines.forEach(l => {
    const parts = l.split('\t');
    const status = (parts[2] || 'SUBMITTED').toUpperCase();
    stages[status] = (stages[status] || 0) + 1;

    if (status === 'SUBMITTED') submitted++;
    if (status === 'INTERVIEW') interviews++;
    if (status === 'OFFER') offers++;
    if (status === 'REJECTED') rejections++;
  });

  const total = lines.length;
  const responses = interviews + offers + rejections;
  const responseRatePct = total > 0 ? ((responses / total) * 100).toFixed(1) + '%' : '0.0%';
  const interviewRatePct = total > 0 ? ((interviews / total) * 100).toFixed(1) + '%' : '0.0%';

  return {
    totalApplications: total,
    submitted,
    interviews,
    offers,
    rejections,
    responseRatePct,
    interviewRatePct,
    stages
  };
}

if (process.argv[1] && process.argv[1].endsWith('analytics.mjs')) {
  const stats = computeApplicationAnalytics();
  console.log('\n📊 APPLICATION FUNNEL ANALYTICS');
  console.log(`=================================`);
  console.log(`Total Applications: ${stats.totalApplications}`);
  console.log(`Submitted:          ${stats.submitted}`);
  console.log(`Interviews:         ${stats.interviews}`);
  console.log(`Offers:             ${stats.offers}`);
  console.log(`Rejections:         ${stats.rejections}`);
  console.log(`Response Rate:      ${stats.responseRatePct}`);
  console.log(`Interview Rate:     ${stats.interviewRatePct}\n`);
}
