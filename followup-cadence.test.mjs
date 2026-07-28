/**
 * followup-cadence.test.mjs — tests for computeNextFollowupDate cadence selection.
 *
 * Focuses on the `responded` branch, where the first follow-up after a recruiter
 * reply must be scheduled with `responded_initial`, not `responded_subsequent`.
 *
 * Run: node followup-cadence.test.mjs
 */

import {
  computeNextFollowupDate,
  addDays,
  parseDate,
  DEFAULT_CADENCE,
  parseFollowups,
} from './followup-cadence.mjs';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
