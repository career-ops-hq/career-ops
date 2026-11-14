import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteEvidence } from '../lib/invite-evidence.mjs';
import { classifyReply } from '../reply-matcher.mjs';

const REF = new Date('2026-11-01T09:00:00');

test('classifyReply does not propose Interview for a vacancy closing time', () => {
  const r = classifyReply({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    received_at: '2026-11-12T09:00:00Z',
    body_snippet: 'The vacancy closes on 20 November 2026 at 17:00. We are currently reviewing applications.',
  });
  assert.equal(r.type, 'Unknown');
  assert.equal(r.suggestedTrackerUpdate, 'Needs Review');
});

test('invite evidence selects the interview time after an unrelated closing time', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: 'The vacancy closes on 20 November 2026 at 17:00. We would like to invite you to an interview on 24 November 2026 at 10:30.',
  });
  assert.equal(r.invite, true);
  assert.equal(r.when, '2026-11-24T10:30');
});

test('invite evidence reads the date line after a plain-text interview confirmation', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: 'Your interview is confirmed.\nDate: 24 November 2026 at 10:30.',
  });
  assert.equal(r.invite, true);
  assert.equal(r.when, '2026-11-24T10:30');
});

test('invite evidence does not use a deadline or a conditional confirmation as a date label', () => {
  for (const text of [
    'Your interview is confirmed.\nApplication deadline: 20 November 2026 at 17:00.',
    'If your interview is confirmed.\nDate: 20 November 2026 at 17:00.',
  ]) {
    const r = inviteEvidence({
      from: 'Jane Smith <jane@example.test>',
      subject: 'Application update',
      date: REF,
      text,
    });
    assert.equal(r.invite, false);
    assert.equal(r.when, '');
  }
});

test('invite evidence preserves a dotted day number inside an interview sentence', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: 'The vacancy closes on 20. November 2026 at 17:00. We would like to invite you to an interview on 24. November 2026 at 10:30.',
  });
  assert.equal(r.invite, true);
  assert.equal(r.when, '2026-11-24T10:30');
});

test('invite evidence keeps the sentence break after a four-digit year', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: 'We interviewed you in 2024. November 2026 at 10:30 is the closing date.',
  });
  assert.equal(r.invite, false);
});

test('invite evidence keeps abbreviated months inside the interview sentence', () => {
  for (const when of ['24 Nov. 2026 at 10:30', '24. Nov. 2026 at 10:30', '24 Nov. at 10:30']) {
    const r = inviteEvidence({
      from: 'Jane Smith <jane@example.test>',
      subject: 'Application update',
      date: REF,
      text: `Your interview is confirmed for ${when}.`,
    });
    assert.equal(r.invite, true, when);
    assert.equal(r.when, '2026-11-24T10:30', when);
  }
});

test('invite evidence keeps a sentence break after a month before a closing time', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: 'We interviewed on 24 November. Closing at 10:30.',
  });
  assert.equal(r.invite, false);
  assert.equal(r.when, '');
});

test('invite evidence uses a bare date in the body of an explicit interview invitation', () => {
  for (const text of ['24 November 2026 at 10:30.', '24. Nov. 2026 at 10:30.',
    '24/11/2026 at 10:30.', 'November 24, 2026 at 10:30.']) {
    const r = inviteEvidence({
      from: 'Jane Smith <jane@example.test>',
      subject: 'Interview invitation',
      date: REF,
      text,
    });
    assert.equal(r.invite, true, text);
    assert.equal(r.when, '2026-11-24T10:30', text);
  }
});

test('invite evidence does not use deadlines as the time for an interview subject', () => {
  for (const text of ['The vacancy closes on 24 November 2026 at 10:30.',
    '24 November 2026, deadline 10:30.', '24/11/2026 closing at 10:30.',
    'Closing 24/11/2026 at 10:30.', '24 November 2026 at 10:30 is the deadline.']) {
    const r = inviteEvidence({
      from: 'Jane Smith <jane@example.test>',
      subject: 'Interview invitation',
      date: REF,
      text,
    });
    assert.equal(r.when, '', text);
  }
});

test('invite evidence requires an invitation subject for a bare date in the body', () => {
  const r = inviteEvidence({
    from: 'Jane Smith <jane@example.test>',
    subject: 'Application update',
    date: REF,
    text: '24 November 2026 at 10:30.',
  });
  assert.equal(r.invite, false);
  assert.equal(r.when, '');
});

test('invite evidence keeps sentence boundaries before a new sentence starting with At', () => {
  for (const day of ['24 November', '24. November', '24 Nov', '24 May', '24 Mai', '24 мая']) {
    const r = inviteEvidence({
      from: 'Jane Smith <jane@example.test>',
      subject: 'Application update',
      date: new Date(day.includes('Nov') ? '2026-11-25T09:00:00' : '2026-05-25T09:00:00'),
      text: `Thank you for applying. We interviewed on ${day}. At 10:30 the vacancy closes.`,
    });
    assert.equal(r.invite, false, day);
    assert.equal(r.when, '', day);
    assert.equal(r.receipt, true, day);
  }
});
