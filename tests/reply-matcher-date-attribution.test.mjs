import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { matchCandidates } from '../reply-matcher.mjs';
import { parseAppliedDate } from '../followup-cadence.mjs';

const candidate = { message_id: 'reply', from: 'careers@acme.com',
  subject: 'Acme Backend Engineer application', body_snippet: 'We will not be moving forward.',
  signal: 'rejection', received_at: '2026-06-20T12:00:00Z' };
const app = { num: 1, company: 'Acme', role: 'Backend Engineer', status: 'Applied', date: '2026-06-01' };
const match = notes => matchCandidates([candidate], [{ ...app, notes }])[0];

for (const notes of [
  'Sibling #154 is live; same ATS; applied 2026-08-04 to that sibling',
  'Sibling #154 is live | same ATS | applied 2026-08-04 to that sibling',
  '#154 is live; same ATS; another undated detail; applied 2026-08-04',
]) {
  try {
    assert.equal(match(notes).application_num, 1);
    pass(`an unresolved sibling subject cannot exclude this row: ${notes}`);
  } catch (error) { fail(error.message); }
}

for (const notes of [
  'Applied 2026-08-04; sibling #154 is live',
  'Sibling #154 applied 2026-06-01; same ATS; Applied 2026-08-04',
  'Sibling #154 is live. Same ATS. Applied 2026-08-04 for this role',
  'Applied 2026-08-04 for this role',
]) {
  try {
    assert.equal(match(notes).application_num, null);
    pass(`a dated or sentence-terminated sibling scope preserves an own date: ${notes}`);
  } catch (error) { fail(error.message); }
}

try {
  const notes = 'Sibling #154 is live; same ATS; applied 2026-08-04 to that sibling';
  assert.equal(parseAppliedDate(notes), '2026-08-04');
  assert.equal(parseAppliedDate(notes, { requireValidCalendarDate: true }), '2026-08-04');
  pass('default cadence and seed parsing retain their documented structural limit');
} catch (error) { fail(error.message); }
