// followup urgency: a live thread with a person to write to is `urgent`.
//
// `urgent` used to be reachable for a `responded` row only while daysSinceApp was below
// responded_initial (1 day), so in practice only on the day the reply landed. Every live
// thread then aged into `overdue` within a day and was reported the same as a dead no-reply
// row, which buries the one conversation that can still convert.
// Run: node test-all.mjs --only followup-urgency-repliable
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeUrgency } from '../followup-cadence.mjs';
import { pass, fail, ROOT } from './helpers.mjs';
import { localToday } from '../lib/local-today.mjs';

console.log('\nfollowup urgency: repliable contact drives severity');

const check = (label, got, want) => (got === want ? pass(label) : fail(`${label}: expected ${want}, got ${got}`));

check('responded, 32d silent, repliable contact -> urgent',
  computeUrgency('responded', 32, null, 0, true), 'urgent');
check('responded, 32d silent, no contact -> overdue',
  computeUrgency('responded', 32, null, 0, false), 'overdue');
check('assessment, 10d silent, repliable contact -> urgent',
  computeUrgency('assessment', 10, null, 0, true), 'urgent');
check('interview past thank-you, repliable contact -> urgent',
  computeUrgency('interview', 10, null, 0, true), 'urgent');
check('interview past thank-you, no contact -> overdue',
  computeUrgency('interview', 10, null, 0, false), 'overdue');
check('responded, last follow-up 4d ago, repliable contact -> urgent',
  computeUrgency('responded', 40, 4, 1, true), 'urgent');

// Not due yet: a contact does not make a fresh follow-up due.
check('responded, followed up 1d ago, repliable contact -> waiting',
  computeUrgency('responded', 40, 1, 1, true), 'waiting');
check('interview inside the thank-you window, repliable contact -> waiting',
  computeUrgency('interview', 0, null, 0, true), 'waiting');

// Backward compatibility: the fifth argument is optional and defaults to the old behaviour.
check('4-arg call still returns overdue',
  computeUrgency('responded', 32, null, 0), 'overdue');

// `applied` is not escalated: no reply has arrived, so an address is not a live conversation.
check('applied, repliable contact stays overdue',
  computeUrgency('applied', 30, null, 0, true), 'overdue');

// End to end through the CLI: the notes decide whether the row has a contact.
function daysAgo(n) {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function urgencyFor(notes) {
  const dir = mkdtempSync(join(tmpdir(), 'co-urgency-repliable-'));
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      `| 1 | ${daysAgo(20)} | Fabrikam Robotics | Platform Engineer | 4.1/5 | Responded | ❌ | — | ${notes} |`,
      '',
    ].join('\n'));
    const env = {
      ...process.env,
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
      CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
      CAREER_OPS_FOLLOWUPS_LOCK: join(dir, 'followups.lock'),
      CAREER_OPS_PROFILE: join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml'),
    };
    const out = execFileSync(process.execPath, [join(ROOT, 'followup-cadence.mjs')], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
    return JSON.parse(out).entries.find((e) => e.num === 1)?.urgency;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

check('CLI: responded row whose notes name a recruiter -> urgent',
  urgencyFor('recruiter Dana (dana@fabrikam.example) said they would call'), 'urgent');
check('CLI: responded row with no contact in the notes -> overdue',
  urgencyFor('rejection email received, no name given'), 'overdue');
check('CLI: a no-reply address alone is not a contact -> overdue',
  urgencyFor('automated reply from noreply@fabrikam.example'), 'overdue');
