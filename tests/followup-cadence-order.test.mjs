#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nfollowup-cadence.mjs — entries ordered most overdue first within a bucket');

const DEFAULT_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');
const NOW = '2026-08-20T12:00:00Z';

const ROWS = [
  [1, '2026-08-05', 'Acme', 'Applied', -8],
  [2, '2026-06-01', 'Globex', 'Applied', -73],
  [3, '2026-08-19', 'Wonka', 'Applied', 6],
  [4, '2026-08-20', 'Initech', 'Responded', 1],
  [5, '2026-07-10', 'Umbrella', 'Applied', -34],
  [6, '2026-08-17', 'Hooli', 'Applied', 4],
  [7, '2026-07-25', 'Vandelay', 'Applied', -19],
  // Same next day as Acme, listed backwards, so only the tracker number orders them.
  [9, '2026-08-05', 'Pied', 'Applied', -8],
  [8, '2026-08-05', 'Piper', 'Applied', -8],
  // Same pinned next day, newer company first in the file, so only application age orders them.
  [11, '2026-07-20', 'Quark', 'Applied', -5],
  [12, '2026-06-15', 'Nimbus', 'Applied', -5],
];
const EXPECTED = [
  'Initech',
  'Globex', 'Umbrella', 'Vandelay', 'Acme', 'Piper', 'Pied', 'Nimbus', 'Quark',
  'Hooli', 'Wonka',
];

const dir = mkdtempSync(join(tmpdir(), 'co-cadence-order-'));
try {
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...ROWS.map(([num, date, company, status]) =>
      `| ${num} | ${date} | ${company} | Platform Engineer | 4.0/5 | ${status} | ❌ | — | https://jobs.${company.toLowerCase()}.example/1 |`),
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'data', 'follow-ups.md'), [
    '# Follow-ups',
    '',
    '- next #11 2026-08-15 (set 2026-08-01)',
    '- next #12 2026-08-15 (set 2026-08-01)',
    '',
  ].join('\n'));

  const freeze = join(dir, 'freeze-clock.mjs');
  writeFileSync(freeze, [
    'const RealDate = Date;',
    `const FROZEN = new RealDate('${NOW}').getTime();`,
    'globalThis.Date = class extends RealDate {',
    '  constructor(...a) { if (a.length === 0) super(FROZEN); else super(...a); }',
    '  static now() { return FROZEN; }',
    '};',
  ].join('\n'));

  const env = {
    ...process.env,
    TZ: 'UTC',
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
    CAREER_OPS_FOLLOWUPS_LOCK: join(dir, 'followups.lock'),
    CAREER_OPS_PROFILE: DEFAULT_CADENCE_PROFILE,
  };
  const out = execFileSync(process.execPath,
    ['--import', pathToFileURL(freeze).href, join(ROOT, 'followup-cadence.mjs'), '--json'],
    { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
  const result = JSON.parse(out);

  if (result.metadata?.analysisDate === '2026-08-20') pass('the engine ran at the frozen date');
  else fail(`the engine did not run at the frozen date: analysisDate ${result.metadata?.analysisDate}`);

  const days = Object.fromEntries(result.entries.map(e => [e.company, e.daysUntilNext]));
  const wrongDays = ROWS.filter(([, , company, , want]) => days[company] !== want)
    .map(([, , company, , want]) => `${company} ${days[company]} (want ${want})`);
  if (wrongDays.length === 0) pass('each entry is due on the expected day');
  else fail(`days until next: ${wrongDays.join(', ')}`);

  const got = result.entries.map(e => e.company);
  if (JSON.stringify(got) === JSON.stringify(EXPECTED)) {
    pass('urgent first, then overdue from most to least overdue, then waiting soonest due first');
  } else {
    fail(`entries order: expected ${JSON.stringify(EXPECTED)}, got ${JSON.stringify(got)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
