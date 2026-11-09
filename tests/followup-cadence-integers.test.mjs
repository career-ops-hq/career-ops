import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';

const root = mkdtempSync(join(tmpdir(), 'cadence-integers-'));
const profilePath = join(root, 'profile.yml');
writeFileSync(profilePath, '{}');
const previousProfile = process.env.CAREER_OPS_PROFILE;
process.env.CAREER_OPS_PROFILE = profilePath;
let cadence;
try {
  cadence = await import('../followup-cadence.mjs');
} finally {
  if (previousProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
  else process.env.CAREER_OPS_PROFILE = previousProfile;
}

const keys = {
  applied_first_days: 'applied_first',
  applied_subsequent_days: 'applied_subsequent',
  applied_max_followups: 'applied_max_followups',
  responded_initial_days: 'responded_initial',
  responded_subsequent_days: 'responded_subsequent',
  interview_thankyou_days: 'interview_thankyou',
};

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

try {
  // Each field must fall back independently rather than truncate malformed
  // profile values into a different scheduling window or follow-up limit.
  for (const value of [1.5, '1.5', '10days', -1, '-1', '', ' ', true, [3], {}, 9007199254740992, '9007199254740992']) {
    writeFileSync(profilePath, JSON.stringify({ followup_cadence: Object.fromEntries(Object.keys(keys).map(key => [key, value])) }));
    eq(`profile rejects ${JSON.stringify(value)} in every cadence field`, cadence.loadProfileCadence(profilePath), {});
    eq(`invalid profile ${JSON.stringify(value)} preserves defaults`, cadence.resolveCadenceConfig({ profilePath, appliedDays: null }), cadence.DEFAULT_CADENCE);
    eq(`direct appliedDays rejects ${JSON.stringify(value)}`, cadence.resolveCadenceConfig({ profilePath, appliedDays: value }).applied_first, cadence.DEFAULT_CADENCE.applied_first);
  }
  for (const [value, expected] of [[0, 0], [3, 3], ['0', 0], ['03', 3], [' +03 ', 3], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    writeFileSync(profilePath, JSON.stringify({ followup_cadence: Object.fromEntries(Object.keys(keys).map(key => [key, value])) }));
    eq(`profile keeps valid integer ${JSON.stringify(value)}`, cadence.loadProfileCadence(profilePath), Object.fromEntries(Object.values(keys).map(key => [key, expected])));
  }
  writeFileSync(profilePath, JSON.stringify({ followup_cadence: { applied_first_days: 1.5, applied_subsequent_days: '10days', applied_max_followups: 0, responded_initial_days: '2' } }));
  eq('invalid fields preserve defaults alongside valid zero and integer strings', cadence.resolveCadenceConfig({ profilePath, appliedDays: null }), { ...cadence.DEFAULT_CADENCE, applied_max_followups: 0, responded_initial: 2 });
  eq('valid CLI override still takes precedence over profile defaults', cadence.resolveCadenceConfig({ profilePath, appliedDays: cadence.parseAppliedDaysOverride('10') }).applied_first, 10);
  eq('CLI rejects integers beyond safe precision', cadence.parseAppliedDaysOverride('9007199254740992'), null);
  eq('CLI accepts the largest safe integer', cadence.parseAppliedDaysOverride(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  eq('CLI retains its digits-only syntax', cadence.parseAppliedDaysOverride('+3'), null);
} finally {
  rmSync(root, { recursive: true, force: true });
}
