#!/usr/bin/env node

/**
 * Covers follow_ups.enabled in config/profile.yml.
 *
 * Drives followup-cadence.mjs and followup-seed.mjs as the CLI and the web
 * app do, against a sandboxed root, once with follow-ups on and once off.
 *
 * Run: node test-all.mjs --only followups-toggle
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nfollow_ups.enabled: turning follow-ups off');

const NODE = process.execPath;

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeRoot(profileYaml) {
  const dir = mkdtempSync(join(tmpdir(), 'co-followups-toggle-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-05 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | Applied 2026-01-05 |',
    '',
  ].join('\n'));
  if (profileYaml !== null) writeFileSync(join(dir, 'config', 'profile.yml'), profileYaml);
  return dir;
}

function run(script, args, dir) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
    CAREER_OPS_FOLLOWUPS_LOCK: join(dir, 'followups.lock'),
    CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml'),
  };
  try {
    return { code: 0, stdout: execFileSync(NODE, [join(ROOT, script), ...args], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 }) };
  } catch (e) {
    return { code: e.status ?? 1, stdout: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const cases = [
  { label: 'no profile', profile: null, enabled: true },
  { label: 'profile without follow_ups', profile: 'candidate:\n  full_name: Test\n', enabled: true },
  { label: 'follow_ups.enabled: true', profile: 'follow_ups:\n  enabled: true\n', enabled: true },
  { label: 'follow_ups.enabled: false', profile: 'follow_ups:\n  enabled: false\n', enabled: false },
  { label: 'unparseable profile', profile: 'follow_ups: [\n', enabled: true },
];

for (const c of cases) {
  const dir = makeRoot(c.profile);
  try {
    const cadence = run('followup-cadence.mjs', ['--json'], dir);
    const result = JSON.parse(cadence.stdout.slice(cadence.stdout.indexOf('{')));
    eq(`${c.label}: cadence entries`, result.entries.map((e) => e.num), c.enabled ? [1] : []);
    eq(`${c.label}: cadence followupsEnabled`, result.followupsEnabled, c.enabled ? undefined : false);
    eq(`${c.label}: cadence still reports defaults`, typeof result.cadenceDefaults?.applied_first, 'number');

    const seed = run('followup-seed.mjs', ['1', '--json'], dir);
    eq(`${c.label}: seed exit code`, seed.code, 0);
    eq(`${c.label}: seed result`, JSON.parse(seed.stdout).seeded, c.enabled);
    eq(`${c.label}: follow-ups file written`, existsSync(join(dir, 'data', 'follow-ups.md')), c.enabled);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = makeRoot('follow_ups:\n  enabled: false\n');
  try {
    const summary = run('followup-cadence.mjs', ['--summary'], dir);
    eq('off: --summary exit code', summary.code, 0);
    eq('off: --summary says follow-ups are off', summary.stdout.trim(), 'Follow-ups are turned off (follow_ups.enabled: false in config/profile.yml).');

    const backfill = run('followup-seed.mjs', ['--backfill', '--json'], dir);
    eq('off: backfill seeds nothing', JSON.parse(backfill.stdout), { seeded: [], skipped: [], reason: 'disabled' });

    const status = run('set-status.mjs', ['1', 'Responded', '--json'], dir);
    const back = run('set-status.mjs', ['1', 'Applied', '--json'], dir);
    eq('off: set-status still changes status', [status.code, back.code], [0, 0]);
    eq('off: set-status reports seeding skipped', JSON.parse(back.stdout.slice(back.stdout.indexOf('{'))).followupSeeded, { seeded: false, nextDate: null, reason: 'disabled' });
    eq('off: set-status wrote no follow-ups file', existsSync(join(dir, 'data', 'follow-ups.md')), false);
    eq('off: tracker shows Applied', /\| Applied \|/.test(readFileSync(join(dir, 'data', 'applications.md'), 'utf-8')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = makeRoot('follow_ups:\n  enabled: false\n');
  try {
    mkdirSync(join(dir, 'data', 'follow-ups.md'));
    const cadence = run('followup-cadence.mjs', ['--json'], dir);
    eq('off: an unreadable follow-ups file is never read', [cadence.code, JSON.parse(cadence.stdout).followupsEnabled], [0, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const apply = readFileSync(join(ROOT, 'modes', 'apply.md'), 'utf-8');
  const steps = apply.slice(apply.indexOf('If the candidate confirms that they submitted the application:')).split('\n\n')[0].split('\n').slice(1);
  const skipped = steps.map((s) => s.includes('follow_ups.enabled: false'));
  eq('apply.md: only the seeding step is skipped when follow-ups are off', skipped, [false, true, false, false]);
  eq('apply.md: the contacto step still runs when follow-ups are off', /contacto.*even when `follow_ups\.enabled` is `false`/.test(steps[3]), true);
}
