#!/usr/bin/env node

/**
 * followup-cadence.mjs measures an application's age from the apply date that
 * set-status.mjs records in status-log.tsv, not from the evaluation date.
 *
 * Run: node test-all.mjs --only followup-cadence-status-log
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import { localToday } from '../lib/local-today.mjs';

console.log('\nfollowup-cadence.mjs — apply date from status-log.tsv');

const NODE = process.execPath;
const DEFAULT_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function daysAgo(n) {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function makeRoot(notes) {
  const dir = mkdtempSync(join(tmpdir(), 'co-cadence-status-log-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 1 | ${localToday()} | Fabrikam Robotics | Platform Engineer | 4.1/5 | Evaluated | ❌ | — | ${notes} |`,
    '',
  ].join('\n'));
  return dir;
}

function run(script, args, dir) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
    CAREER_OPS_FOLLOWUPS_LOCK: join(dir, 'followups.lock'),
    CAREER_OPS_PROFILE: DEFAULT_CADENCE_PROFILE,
  };
  return execFileSync(NODE, [join(ROOT, script), ...args], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
}

function entryAfterApplying(notes, appliedOn) {
  const dir = makeRoot(notes);
  try {
    run('set-status.mjs', ['1', 'Applied', '--on', appliedOn], dir);
    return JSON.parse(run('followup-cadence.mjs', [], dir)).entries.find(e => e.num === 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const appliedOn = daysAgo(17);
  const entry = entryAfterApplying('careers page', appliedOn);
  eq('the apply date comes from set-status --on', entry?.appliedDate, appliedOn);
  eq('the apply date is labelled as read from status-log.tsv', entry?.appDateSource, 'status-log');
  eq('the age counts from the apply date', entry?.daysSinceApplication, 17);
  eq('the follow-up is due 7 days after the apply date', entry?.nextFollowupDate, daysAgo(10));
}

{
  const notesDate = daysAgo(20);
  const entry = entryAfterApplying(`Applied ${notesDate} via careers page`, daysAgo(3));
  eq('an apply date written in the notes still wins', entry?.appliedDate, notesDate);
  eq('the notes date keeps its notes label', entry?.appDateSource, 'notes');
}

{
  const dir = makeRoot('careers page');
  try {
    run('set-status.mjs', ['1', 'Applied'], dir);
    writeFileSync(join(dir, 'data', 'status-log.tsv'), '1\t2026-02-30\tEvaluated\tApplied\tset-status\t\n');
    const entry = JSON.parse(run('followup-cadence.mjs', [], dir)).entries.find(e => e.num === 1);
    eq('an impossible ledger date falls back to the evaluation date', entry?.appDateSource, 'evaluation-date-fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
