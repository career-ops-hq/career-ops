/**
 * tests/followup-cadence-glued-hash.test.mjs — a `#N` glued to a word is an
 * external tag, not a tracker-row cross-reference.
 *
 * isCrossReferencedMention() discards an apply date that follows a `#N` row
 * pointer ("see #7; applied ..." is row 7's date). Tags like "job-search#7" or
 * "gh#12" are namespaced ids from elsewhere, and reading them as row pointers
 * dropped the row's own date.
 *
 * Run: node test-all.mjs --only followup-cadence-glued-hash
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

console.log('\nfollowup-cadence.mjs — word-glued #N tags are not cross-references');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pin the cadence source for the import only, so the module never reads the
// user's config/profile.yml and the env var does not leak into later suites
// (see tests/followup-cadence.test.mjs, #2268 / #3306).
const PRIOR_PROFILE_ENV = process.env.CAREER_OPS_PROFILE;
process.env.CAREER_OPS_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');

let cadence;
try {
  cadence = await import('../followup-cadence.mjs');
} finally {
  if (PRIOR_PROFILE_ENV === undefined) delete process.env.CAREER_OPS_PROFILE;
  else process.env.CAREER_OPS_PROFILE = PRIOR_PROFILE_ENV;
}

// The cross-reference lookback is 120 characters before "applied". Padding
// that puts the `#` exactly on the window's first character exercises the
// slice boundary, where a lookbehind alone cannot see the glued prefix.
const atWindowStart = (prefix) => `${prefix}#7 ${'y'.repeat(116)} applied 2026-09-21`;

for (const [note, want, why] of [
  ['job-search#7; Applied 2026-09-21 via Greenhouse; follow up 28 Sep', '2026-09-21', 'hyphenated external tag'],
  ['gh#12 applied 2026-09-21', '2026-09-21', 'word-glued external tag'],
  [atWindowStart('gh'), '2026-09-21', 'glued tag whose # starts the lookback window'],
  ['see #7; applied 2026-09-21', null, 'bare #N still a cross-reference'],
  [atWindowStart('see '), null, 'bare #N at the lookback window start still a cross-reference'],
]) {
  const got = cadence.parseAppliedDate(note);
  if (got === want) pass(`parseAppliedDate: ${why} → ${JSON.stringify(want)}`);
  else fail(`parseAppliedDate ${why}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
