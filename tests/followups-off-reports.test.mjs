import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

console.log('\nstats and funnel-velocity summaries while follow-ups are off');

const sandboxes = [];

function sandbox(followupsEnabled, followupsMd = '# Follow-ups\n') {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-followups-off-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  const rows = Array.from({ length: 25 }, (_, i) =>
    `| ${i + 1} | 2026-08-01 | Company ${i + 1} | Data Analyst | 4.0/5 | Applied | ❌ | | Applied 2026-08-01 |`);
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows, '',
  ].join('\n'));
  writeFileSync(join(dir, 'data', 'follow-ups.md'), followupsMd);
  writeFileSync(join(dir, 'config', 'profile.yml'), `follow_ups:\n  enabled: ${followupsEnabled}\n`);
  return dir;
}

function summary(script, dir) {
  const run = spawnSync(NODE, [join(ROOT, script), '--summary'], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: '' },
  });
  assert.equal(run.status, 0, describeSpawn(run));
  return run.stdout;
}

try {
  assert.match(summary('funnel-velocity.mjs', sandbox(true)), /followup mode/);
  const off = summary('funnel-velocity.mjs', sandbox(false));
  assert.doesNotMatch(off, /follow-?up/i);
  assert.match(off, /beyond typical/);
  assert.match(off, /patterns mode/);
  pass('funnel-velocity points at followup mode only while follow-ups are on');
} catch (err) {
  fail(`funnel-velocity summary with follow-ups off: ${err.message}`);
}

try {
  assert.match(summary('stats.mjs', sandbox(true)), /Applied apps with none/);
  const off = summary('stats.mjs', sandbox(false));
  assert.doesNotMatch(off, /Applied apps with none/);
  assert.match(off, /Follow-ups: turned off/);
  pass('stats summary does not count Applied rows without a follow-up while follow-ups are off');
} catch (err) {
  fail(`stats summary with follow-ups off: ${err.message}`);
}

// 'Cold' is followup-cadence's verdict on an Applied row that has had
// applied_max_followups follow-ups (default 2) with no reply. A follow-ups.md
// left over from before the user turned follow-ups off still carries those
// rows, so the Tracker line must not report them cold beside a Follow-ups
// line saying follow-ups are off.
const twoFollowupsForRow1 = [
  '| # | App | Date | Company | Role | Channel | Contact | Notes |',
  '|---|-----|------|---------|------|---------|---------|-------|',
  '| 1 | 1 | 2026-08-10 | Company 1 | Data Analyst | email | jane | f1 |',
  '| 2 | 1 | 2026-08-20 | Company 1 | Data Analyst | email | jane | f2 |',
  '',
].join('\n');

try {
  assert.match(summary('stats.mjs', sandbox(true, twoFollowupsForRow1)), /25 active \(24 live, 1 cold\)/);
  const off = summary('stats.mjs', sandbox(false, twoFollowupsForRow1));
  assert.doesNotMatch(off, /\bcold\b/);
  assert.match(off, /Tracker: +25 total \| 25 active/);
  assert.match(off, /Follow-ups: turned off/);
  pass('stats summary does not call Applied rows cold while follow-ups are off');
} catch (err) {
  fail(`stats summary cold breakdown with follow-ups off: ${err.message}`);
}

for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
