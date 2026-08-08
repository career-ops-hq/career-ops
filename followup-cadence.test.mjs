/**
 * followup-cadence.test.mjs — tests for computeNextFollowupDate cadence selection.
 *
 * Focuses on the `responded` branch, where the first follow-up after a recruiter
 * reply must be scheduled with `responded_initial`, not `responded_subsequent`.
 *
 * Run: node followup-cadence.test.mjs
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');
const CUSTOM_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-custom-cadence.yml');

// Pin the cadence source BEFORE followup-cadence.mjs is evaluated. Its
// module-level `CADENCE = resolveCadenceConfig()` reads CAREER_OPS_PROFILE at
// import time and otherwise falls back to the USER's config/profile.yml — so
// on a machine where the user customized followup_cadence, assertions written
// against DEFAULT_CADENCE failed on a perfectly healthy install (#2268).
//
// The import below must stay DYNAMIC: ESM hoists static imports above every
// statement in this file, so a static import would run the module before this
// assignment and the pin would do nothing.
process.env.CAREER_OPS_PROFILE = DEFAULT_CADENCE_PROFILE;

const {
  computeNextFollowupDate,
  addDays,
  parseDate,
  DEFAULT_CADENCE,
  parseFollowups,
  analyzeFromContent,
  normalizeStatus,
  resolveCadenceConfig,
  loadProfileCadence,
} = await import('./followup-cadence.mjs');

let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const APP = '2026-06-30';

// The first follow-up after a recruiter response is due at appDate + responded_initial.
// responded_initial (and its profile override responded_initial_days) is otherwise only
// read by computeUrgency, so before the fix it had no effect on the scheduled date.
eq(
  'responded, no prior follow-up uses responded_initial',
  computeNextFollowupDate('responded', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.responded_initial),
);

// Subsequent follow-ups still use responded_subsequent, counted from the last follow-up.
eq(
  'responded, with prior follow-up uses responded_subsequent',
  computeNextFollowupDate('responded', APP, '2026-07-02', 1),
  addDays(parseDate('2026-07-02'), DEFAULT_CADENCE.responded_subsequent),
);

// The initial next-date must not land after the overdue threshold, otherwise a row can be
// flagged "overdue" (daysSinceApp >= responded_subsequent) while its own next-follow-up
// date is still in the future, which is impossible for a date meant to trigger "overdue".
eq(
  'initial next follow-up is not later than the overdue threshold',
  computeNextFollowupDate('responded', APP, null, 0) <=
    addDays(parseDate(APP), DEFAULT_CADENCE.responded_subsequent),
  true,
);

// Regression: the applied branch is unchanged.
eq(
  'applied, no follow-ups uses applied_first',
  computeNextFollowupDate('applied', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.applied_first),
);

// --- parseFollowups (exported content-param parser) ---

const FOLLOWUPS_MD = `# Follow-ups

| num | appNum | date | company | role | channel | contact | notes |
|-----|--------|------|---------|------|---------|---------|-------|
| 1 | 42 | 2026-07-01 | Acme | Backend Eng | email | jane@acme.com | first nudge |
| 2 | 42 | 2026-07-08 | Acme | Backend Eng | email | jane@acme.com |  |
- next #42 2026-07-15 (set 2026-07-08)
| 3 | 55 | 2026-07-05 | Globex | SRE | linkedin |  |
`;

eq(
  'parseFollowups parses table rows, skipping header/separator',
  parseFollowups(FOLLOWUPS_MD).map(e => e.num),
  [1, 2, 3],
);

eq(
  'parseFollowups skips pin-directive lines (not treated as sent follow-ups)',
  parseFollowups(FOLLOWUPS_MD).some(e => e.date === '2026-07-15'),
  false,
);

eq(
  'parseFollowups full shape for a normal row',
  parseFollowups(FOLLOWUPS_MD)[0],
  {
    num: 1,
    appNum: 42,
    date: '2026-07-01',
    company: 'Acme',
    role: 'Backend Eng',
    channel: 'email',
    contact: 'jane@acme.com',
    notes: 'first nudge',
  },
);

eq(
  'parseFollowups tolerates missing trailing cells (empty notes)',
  parseFollowups(FOLLOWUPS_MD).find(e => e.num === 2).notes,
  '',
);

eq(
  'parseFollowups tolerates a row missing the contact cell entirely',
  parseFollowups(FOLLOWUPS_MD).find(e => e.num === 3).contact,
  '',
);

eq(
  'parseFollowups returns empty array for empty content',
  parseFollowups(''),
  [],
);

// analyzeFromContent (#2123): the content-based core exported so stats.mjs
// can reuse the exact same cadence math for its own cold-classification
// wiring, instead of re-deriving applied_max_followups/cadence rules there.
const trackerMd = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-05-01 | Acme | Eng | 4.5/5 | Applied | ✅ | ❌ | note |',
  '| 2 | 2026-05-01 | Beta | Eng | 4.0/5 | Applied | ✅ | ❌ | note |',
].join('\n');
const followupsMd = [
  '| # | App | Date | Company | Role | Channel | Contact | Notes |',
  '|---|-----|------|---------|------|---------|---------|-------|',
  '| 1 | 1 | 2026-05-10 | Acme | Eng | email | jane | f1 |',
  '| 2 | 1 | 2026-05-20 | Acme | Eng | email | jane | f2 |',
].join('\n');

const withFollowups = analyzeFromContent(trackerMd, followupsMd);
eq(
  'analyzeFromContent classifies app #1 cold after applied_max_followups follow-ups, app #2 stays actionable',
  withFollowups.entries.filter((e) => e.urgency === 'cold').map((e) => e.num),
  [1],
);

// Missing/empty follow-ups content must degrade gracefully — no follow-up
// log means followupCount stays 0 for every row, so nothing can reach the
// 'cold' threshold. No error, no guessing.
const noFollowups = analyzeFromContent(trackerMd, '');
eq(
  'analyzeFromContent with no follow-ups content classifies nothing as cold',
  noFollowups.entries.some((e) => e.urgency === 'cold'),
  false,
);
const missingFollowupsArg = analyzeFromContent(trackerMd);
eq(
  'analyzeFromContent defaults followupsContent to empty string when omitted',
  missingFollowupsArg.entries.some((e) => e.urgency === 'cold'),
  false,
);

// Hired aliases from templates/states.yml must normalize to 'hired'. Before
// this, 'Accepted'/'Contratado' normalized to themselves, so stats/funnel/
// company-history consumers looking for 'hired' silently dropped those rows.
for (const raw of ['Hired', 'Accepted', 'accept', 'Contratado', 'contratada']) {
  eq(`normalizeStatus('${raw}') canonicalizes to hired`, normalizeStatus(raw), 'hired');
}

// #2268 — the suite pins the profile so a user's own followup_cadence can't
// turn a healthy install red. These two guard the pin from the opposite
// failure: pinning must not degrade into ignoring the profile altogether.
eq(
  'a fixture profile with no followup_cadence yields the defaults',
  loadProfileCadence(DEFAULT_CADENCE_PROFILE),
  {},
);
eq(
  'a customized profile is still read through profilePath',
  resolveCadenceConfig({ profilePath: CUSTOM_CADENCE_PROFILE, appliedDays: null }),
  {
    applied_first: 3,
    applied_subsequent: 30,
    applied_max_followups: 5,
    responded_initial: 2,
    responded_subsequent: 9,
    interview_thankyou: 4,
  },
);
eq(
  'the pinned default profile resolves to DEFAULT_CADENCE',
  resolveCadenceConfig({ profilePath: DEFAULT_CADENCE_PROFILE, appliedDays: null }),
  DEFAULT_CADENCE,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
