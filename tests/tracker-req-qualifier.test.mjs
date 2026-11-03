// tests/tracker-req-qualifier.test.mjs — extractReqNumber must see through a
// snake_case id-parameter name between the label and the id.
//
// A notes cell can carry the spelling `job id gh_jid 1234567`. The id token
// requires a digit and `gh_jid` has none, so the whole match fails and
// extractReqNumber returns null, which silently disables the #1524 sibling-req
// guard for that row: two distinct postings with near-identical titles can then
// fuzzy-match into one tracker row with nothing reporting it.
import { pass, fail } from './helpers.mjs';
import { extractReqNumber } from '../tracker-parse.mjs';

console.log('\ntracker-parse — req id behind an id-parameter name');

const cases = [
  // [notes, expected id, label]
  ['job id gh_jid 1234567. see posting', '1234567', 'label + snake_case qualifier + id'],
  ['job id 1234567 (Greenhouse gh_jid)', '1234567', 'qualifier after the id (already worked)'],
  ['req JR-10423', 'JR-10423', 'documented form `req JR-10423`'],
  ['job id 88214', '88214', 'documented form `job id 88214`'],
  // Guard: the qualifier skip must not invent an id out of digit-free prose.
  ['job board posting, no id here', null, 'no id → null'],
  // Guard: a snake_case word that only starts with a label is not a qualifier.
  ['job_posted_at 2026-10-01', null, 'label-prefixed snake_case word → null'],
  // Guard: only id-parameter names are skipped, so a date behind any other
  // snake_case word is never read as an id.
  ['job posted_at 2026-10-01', null, 'date behind posted_at → null'],
  ['req date_applied 2026-10-01', null, 'date behind date_applied → null'],
  ['posting first_seen: 2026-08-01', null, 'date behind first_seen → null'],
  ['req salary_min 120000', null, 'number behind a non-id word → null'],
  ['posting posting_id: 5340', '5340', 'generic id parameter name is skipped'],
];

for (const [notes, want, label] of cases) {
  const got = extractReqNumber(notes);
  got === want
    ? pass(`${label}: ${JSON.stringify(notes)} → ${JSON.stringify(got)}`)
    : fail(`${label}: ${JSON.stringify(notes)} → ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
