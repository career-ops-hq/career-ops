import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { extractConstraints, analyzeInvite } from '../invite-match.mjs';

function check(name, run) {
  try { run(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
}
const keys = text => extractConstraints(text).map(c => c.key);
const base = 'We would like to invite you to schedule your interview. It will take 45 minutes.';

const cases = [
  ['no-ai', 'The use of AI tools at any stage of the process is not permitted unless authorized by Northwind Labs.', 'We encourage you to read about our AI roadmap.'],
  ['recorded', 'Please note this interview will be recorded for note-taking.', 'We will send a recap after the call.'],
  ['no-recording', 'Recording of the session is not permitted. Please do not record the call.', 'Please keep notes during the call.'],
  ['camera-required', 'Your camera must be on throughout the conversation.', 'You can join from any quiet room.'],
  ['test-link', 'Please test the video link beforehand to avoid delays.', 'The link will be active at start time.'],
  ['id-required', 'Photo ID is required to join the session.', 'No documents are needed.'],
];
for (const [key, positive, negative] of cases) {
  check(`${key}: detected`, () => assert.ok(keys(`${base} ${positive}`).includes(key), JSON.stringify(extractConstraints(positive))));
  check(`${key}: not detected without the phrase`, () => assert.ok(!keys(`${base} ${negative}`).includes(key)));
}

check('tag form mirrors the [process-friction] convention', () => {
  const c = extractConstraints(`${base} Photo ID is required.`).find(x => x.key === 'id-required');
  assert.equal(c.tag, '[constraint:id-required]');
});

check('panel: names extracted from "with NAME - TITLE and NAME - TITLE"', () => {
  const c = extractConstraints('Your interview is with Jordan Reyes - Director of Ops and Sam Ito - Program Manager. 30 minutes.').find(x => x.key === 'panel');
  assert.ok(c);
  assert.equal(c.detail, 'Jordan Reyes; Sam Ito');
});
check('panel: a single interviewer is not a panel', () => {
  assert.ok(!keys('Your interview is with Jordan Reyes - Director of Ops. 30 minutes.').includes('panel'));
});

check('length-not-stated: invite with no duration', () => {
  assert.ok(keys('We would like to invite you to schedule your interview on 2026-11-02.').includes('length-not-stated'));
});
check('length-not-stated: absent when minutes or hours are given', () => {
  assert.ok(!keys('We would like to invite you to schedule your interview. Plan for 45 minutes.').includes('length-not-stated'));
  assert.ok(!keys('We would like to invite you to schedule your interview. It lasts 1 hour.').includes('length-not-stated'));
});

check('invite with none of the constraints (and a stated length) yields []', () => {
  assert.deepEqual(extractConstraints(base), []);
});
check('empty / non-string input yields []', () => {
  assert.deepEqual(extractConstraints(''), []);
  assert.deepEqual(extractConstraints(null), []);
});
check('unrelated text does not gain length-not-stated', () => {
  assert.deepEqual(extractConstraints('Thanks for the update.'), []);
});

check('analyzeInvite keeps every existing key and adds constraints', () => {
  const rows = [{ num: 7, company: 'Northwind Labs', role: 'Analyst', status: 'Applied', date: '2026-10-01', notes: '' }];
  const text = 'Company: Northwind Labs\nWe would like to invite you to schedule your interview.\nJoin via Zoom: https://zoom.us/j/1234567890\nAI tools are not permitted.';
  const r = analyzeInvite(text, rows);
  assert.deepEqual(Object.keys(r), ['signals', 'classification', 'matchedPhrases', 'phraseStrength', 'candidates', 'constraints', 'clarificationDraft']);
  assert.deepEqual(Object.keys(r.signals), ['company', 'date', 'reqId', 'platform', 'isAIInterviewer']);
  assert.equal(r.signals.platform, 'Zoom');
  assert.equal(r.candidates[0].appNumber, 7);
  assert.ok(r.constraints.some(c => c.key === 'no-ai'));
});

// --- review follow-ups (#5734) ---
check('panel: two named interviewers without titles', () => {
  const c = extractConstraints(`${base} Your interview is with Jordan Reyes and Sam Ito.`).find(x => x.key === 'panel');
  assert.ok(c, 'panel expected');
  assert.equal(c.detail, 'Jordan Reyes; Sam Ito');
});
check('panel: three untitled names with a serial comma', () => {
  const c = extractConstraints(`${base} You will meet with Jordan Reyes, Sam Ito, and Priya Nair.`).find(x => x.key === 'panel');
  assert.ok(c);
  assert.equal(c.detail, 'Jordan Reyes; Sam Ito; Priya Nair');
});
check('panel: platforms are not interviewers', () => {
  assert.ok(!keys(`${base} Please join with Microsoft Teams and Zoom.`).includes('panel'));
});
check('negated constraints are not reported', () => {
  assert.ok(!keys(`${base} AI tools are not prohibited.`).includes('no-ai'));
  assert.ok(!keys(`${base} A camera is not required.`).includes('camera-required'));
  assert.ok(!keys(`${base} Photo ID is not required.`).includes('id-required'));
});
check('affirmative constraints are still reported', () => {
  assert.ok(keys(`${base} AI tools are prohibited.`).includes('no-ai'));
  assert.ok(keys(`${base} A camera is required.`).includes('camera-required'));
  assert.ok(keys(`${base} Photo ID is required.`).includes('id-required'));
});
check('length-not-stated: a preparation interval is not the interview length', () => {
  assert.ok(keys('We would like to invite you to schedule your interview. Please join 10 minutes early.').includes('length-not-stated'));
  assert.ok(keys('We would like to invite you to schedule your interview. Please reply within 24 hours.').includes('length-not-stated'));
});
check('length-not-stated: a stated length still counts next to a preparation interval', () => {
  assert.ok(!keys('We would like to invite you to schedule your interview. It lasts 30 minutes. Please join 10 minutes early.').includes('length-not-stated'));
});

check('length-not-stated: an interview length in the same sentence as "join" still counts', () => {
  assert.ok(!keys('We would like to invite you to schedule your interview. Join us for a 45-minute interview.').includes('length-not-stated'));
  assert.ok(!keys('We would like to invite you to schedule your interview. Please join the call; it will take 30 minutes.').includes('length-not-stated'));
});
check('length-not-stated: "join N minutes early" with no length is still not-stated', () => {
  assert.ok(keys('We would like to invite you to schedule your interview. Please join 10 minutes early.').includes('length-not-stated'));
  assert.ok(keys('We would like to invite you to schedule your interview. Please join at least 15 minutes before the start.').includes('length-not-stated'));
});

check('length-not-stated: "30 minutes after introductions" is an interview length', () => {
  assert.ok(!keys('We would like to invite you to schedule your interview. It will last 30 minutes after introductions.').includes('length-not-stated'));
});
check('length-not-stated: "after N minutes" (a wait, not a length) is still not a stated length', () => {
  assert.ok(keys('We would like to invite you to schedule your interview. The link expires after 30 minutes of inactivity.').includes('length-not-stated'));
});

check('length-not-stated: a start-time offset is not the interview length', () => {
  const pre = 'We would like to invite you to schedule your interview. ';
  assert.ok(keys(pre + 'The interview starts 30 minutes after the assessment.').includes('length-not-stated'));
  assert.ok(!keys(pre + 'It will last 30 minutes after introductions.').includes('length-not-stated'));
});
check('length-not-stated: common length phrasings are recognised', () => {
  const pre = 'We would like to invite you to schedule your interview. ';
  for (const t of ['Your interview will be 30 minutes.', 'The call is about 45 minutes.', 'Duration: 30 minutes.', 'Interview (30 minutes).', 'This is a one-hour interview.', 'Plan for 45 minutes.', 'The call is 30 minutes long.']) {
    assert.ok(!keys(pre + t).includes('length-not-stated'), t);
  }
  for (const t of ['Please join 10 minutes early.', 'Reply within 24 hours.', 'The link expires after 30 minutes of inactivity.']) {
    assert.ok(keys(pre + t).includes('length-not-stated'), t);
  }
});
