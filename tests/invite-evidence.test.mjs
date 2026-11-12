// tests/invite-evidence.test.mjs — lib/invite-evidence.mjs and its two callers (#6167).
//
// The fixtures are shaped on real recruiting mail, rewritten with invented
// people and companies. The negative ones (receipts, process descriptions,
// rejections) must stay negative: that is what keeps the evidence pass honest
// as the list of booking providers grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteEvidence, parseProposedTime, formatWallTime } from '../lib/invite-evidence.mjs';
import { analyzeInvite } from '../invite-match.mjs';
import { classifyReply } from '../reply-matcher.mjs';

const REF = new Date('2026-11-01T09:00:00');
const when = (t, ref = REF) => formatWallTime(parseProposedTime(t, ref));

// ── Negatives: never an invite ────────────────────────────────────────
const NEGATIVES = [
  { name: 'receipt with a process description', from: 'no-reply@acme.example', subject: 'We have got it! Your application to Acme',
    text: "Hello Alex, we've successfully received your application. Here is a quick look at our process: Initial CV screen. First touchpoint: if there's a match, we'll invite you to an initial screening call. Deep dive: follow-up interviews." },
  { name: 'German receipt', from: 'bewerbung@beispiel.example', subject: 'Eingangsbestätigung Ihrer Bewerbung',
    text: 'Vielen Dank für Ihre Bewerbung. Ihre Unterlagen sind bei uns eingegangen. Sollte Ihr Profil passen, melden wir uns für ein Kennenlernen.' },
  { name: 'receipt promising contact', from: 'careers@globex.example', subject: 'Thank you for applying to Globex',
    text: 'Thank you for applying. Our recruiting team will review your application and we will be in touch if your experience matches the role.' },
  { name: 'rejection', from: 'talent@initech.example', subject: 'Your application to Initech',
    text: 'Thank you for your interest. Unfortunately we have decided not to move forward with your application at this time.' },
];

for (const n of NEGATIVES) {
  test(`not an invite: ${n.name}`, () => {
    const e = inviteEvidence({ ...n, date: REF });
    assert.equal(e.invite, false, e.reasons.join('; '));
    assert.equal(e.when, '');
  });
}

// ── Positives ─────────────────────────────────────────────────────────
test('direct invitation with a booking link', () => {
  const e = inviteEvidence({ from: 'Maria Lopez <maria.lopez@acme.example>', subject: "Let's chat about your application at Acme",
    text: 'We are impressed with your background and would like to invite you to an interview. Please use the link to schedule your chat.',
    links: ['https://calendly.com/maria-lopez-acme/intro'] });
  assert.equal(e.invite, true);
  assert.match(e.bookingLink, /calendly\.com/);
});

test('a calendar invite carries the proposed time and the meeting link', () => {
  const e = inviteEvidence({ from: 'Lena Berg <lena.berg@globex.example>', hasCalendar: true, date: new Date('2026-03-12'),
    subject: 'Invitation: Interview with Lena from Globex - Wed 18 Mar 2026 09:00 - 09:30',
    text: 'Interview with Lena. Join: https://meet.google.com/abc-defg-hij', links: ['https://calendar.google.com/calendar/event?action=VIEW&eid=x'] });
  assert.equal(e.invite, true);
  assert.equal(e.when, '2026-03-18T09:00');
  assert.match(e.meetingLink, /meet\.google\.com/);
  assert.match(e.calendarLink, /calendar\.google\.com\/calendar\/event/);
});

test('an invite that opens with "thank you for your application" is still an invite', () => {
  const e = inviteEvidence({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Invitation to a first interview',
    text: 'Thank you for your application. We would like to invite you to a first interview on 12.11.2026 at 10:30 am via Microsoft Teams.', date: REF });
  assert.equal(e.invite, true);
  assert.equal(e.when, '2026-11-12T10:30');
  assert.equal(e.receipt, false);
});

test('a German invitation is read', () => {
  const e = inviteEvidence({ from: 'Jana Koch <jana.koch@beispiel.example>', subject: 'Einladung zum Kennenlerngespräch',
    text: 'Wir möchten Sie gerne zu einem ersten Gespräch einladen, am 05.11.2026 um 14:00 Uhr.', date: REF });
  assert.equal(e.invite, true);
  assert.equal(e.when, '2026-11-05T14:00');
});

// ── Dates ─────────────────────────────────────────────────────────────
test('proposed times in EN, DE and RU formats', () => {
  assert.equal(when('on Friday, 06.11.2026 at 01:00 pm (CET)'), '2026-11-06T13:00');
  assert.equal(when('DATE/TIME 13-11-2026 10:30 am - 11:15 am CET'), '2026-11-13T10:30');
  assert.equal(when('Date: Thu, 12/10/26 Time: 1:00 - 1:30 pm CET'), '2026-12-10T13:00', 'a weekday decides US month/day');
  assert.equal(when('am 05.11.2026 um 14:00 Uhr'), '2026-11-05T14:00');
  assert.equal(when('вт, 17 нояб 2026 14:15 - 14:30'), '2026-11-17T14:15');
  assert.equal(when('your interview with Sam on Friday, 20th of November at 12 pm'), '2026-11-20T12:00');
  assert.equal(when('a 12 month contract'), '', 'a bare number is not a time');
  assert.equal(when('see you on 01.01.2020 at 10:00'), '', 'outside the window around the email date');
  assert.equal(when('on 11/20/26 at 10:30 am'), '2026-11-20T10:30', 'a second part over 12 is the day: US month/day');
  assert.equal(when('on 31.11.2026 at 10:00'), '', 'a day the month does not have is not a date');
  assert.equal(when('20 Nov 2026 at 10:00; 21.11.2026 at 11:00'), '2026-11-20T10:00', 'the first date in text order, whatever its format');
});

test('booking links are matched on the host, not on text in the URL', () => {
  const base = { from: 'Maria Lopez <maria.lopez@acme.example>', subject: 'Your application to Acme', text: 'Thank you for applying. We received your application.', date: REF };
  assert.equal(inviteEvidence({ ...base, links: ['https://local.com/privacy'] }).bookingLink, '');
  assert.equal(inviteEvidence({ ...base, links: ['https://local.com/privacy'] }).invite, false);
  const e = inviteEvidence({ ...base, text: 'Please book a slot for your interview.', links: ['https://cal.com/maria/interview'] });
  assert.match(e.bookingLink, /^https:\/\/cal\.com\//);
});

test('a bookings.* host alone and a meeting provider in a query string are not evidence', () => {
  const base = { from: 'Maria Lopez <maria.lopez@acme.example>', subject: 'Your application to Acme', date: REF,
    text: 'Thank you for applying. We received your application. Our office reopens on 05.11.2026 at 09:00.' };
  const b = inviteEvidence({ ...base, links: ['https://bookings.example.net/anything'] });
  assert.equal(b.bookingLink, '');
  assert.equal(b.invite, false, b.reasons.join('; '));
  const m = inviteEvidence({ ...base, links: ['https://example.net/?next=teams.microsoft.com/l/meetup-join/abc'] });
  assert.equal(m.invite, false, m.reasons.join('; '));
  assert.equal(m.receipt, true);
  const ok = inviteEvidence({ ...base, text: 'Join our interview on 05.11.2026 at 09:00.', links: ['https://outlook.office365.com/book/AcmeRecruiting@acme.example/'] });
  assert.match(ok.bookingLink, /outlook\.office365\.com\/book\//);
});

test('an unrelated time does not cancel conditional wording', () => {
  const e = inviteEvidence({ from: 'careers@globex.example', subject: 'Thank you for applying to Globex', date: REF,
    text: 'Thank you for applying. If there is a match, we will invite you to an interview. Our office reopens on 05.11.2026 at 09:00.' });
  assert.equal(e.invite, false, e.reasons.join('; '));
  assert.equal(e.receipt, true);
});

// ── Callers ───────────────────────────────────────────────────────────
test('analyzeInvite: a receipt that mentions an interview is not classified as an invite', () => {
  const r = analyzeInvite(NEGATIVES[0].text, [], { clarificationDraft: false });
  assert.notEqual(r.classification, 'invite');
  assert.equal(r.inviteEvidence.invite, false);
});

test('analyzeInvite: an invite the phrase list misses (a time and a meeting link) is classified as an invite', () => {
  // A date a few days ahead of today: the pass only accepts times near the email's date.
  const d = new Date(Date.now() + 5 * 864e5);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const r = analyzeInvite(`Hi Alex, here is the link for our call on ${date} at 10:30 am: https://teams.microsoft.com/l/meetup-join/abc`, [], { clarificationDraft: false });
  assert.equal(r.classification, 'invite');
  assert.match(r.inviteEvidence.meetingLink, /teams\.microsoft\.com/);
  assert.match(r.inviteEvidence.when, /T10:30$/);
});

test('analyzeInvite: a rejection stays a rejection', () => {
  const r = analyzeInvite(NEGATIVES[3].text, [], { clarificationDraft: false });
  assert.equal(r.classification, 'rejection');
});

test('classifyReply: an invite that opens with receipt wording is an Interview, a plain receipt stays Auto-confirmation', () => {
  const invite = classifyReply({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Invitation to a first interview',
    body_snippet: 'Thank you for applying. We would like to invite you to a first interview, please book a slot: https://calendly.com/initech/interview' });
  assert.equal(invite.type, 'Interview');
  assert.equal(invite.suggestedTrackerUpdate, 'Interview');
  const receipt = classifyReply({ from: 'no-reply@globex.example', subject: 'Application received', body_snippet: 'Thank you for applying. We received your application.' });
  assert.equal(receipt.type, 'Auto-confirmation');
  const direct = classifyReply({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Your application at Initech',
    body_snippet: 'Thank you for applying. We would like to invite you to an interview with our product team.' });
  assert.equal(direct.type, 'Interview', 'a direct invitation from a person, no strong signal');
});

test('classifyReply: an interview still to be booked stays Need Action', () => {
  const r = classifyReply({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Next step: your interview',
    body_snippet: 'Thank you for applying. Please pick a time for your interview: https://calendly.com/initech/interview' });
  assert.equal(r.type, 'Need Action');
  assert.equal(r.suggestedTrackerUpdate, 'Interview');
});

test('classifyReply: a confirmed invite that also asks for information keeps the Interview update', () => {
  const r = classifyReply({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Interview invitation',
    body_snippet: 'We would like to invite you to an interview with our product team. Please provide information about your notice period before the call.' });
  assert.equal(r.type, 'Need Action');
  assert.equal(r.suggestedTrackerUpdate, 'Interview');
});

test('analyzeInvite reads the Subject header of a pasted email', () => {
  const r = analyzeInvite('From: Lena Berg <lena.berg@globex.example>\nSubject: Invitation to a first interview at Globex\n\nThank you for your application. Lena will be in touch with the details.', [], { clarificationDraft: false });
  assert.ok(r.inviteEvidence.reasons.some((x) => /invite in the subject/.test(x)), r.inviteEvidence.reasons.join('; '));
  assert.equal(r.classification, 'invite');
});

test('classifyReply reads a proposed time relative to the received date', () => {
  const r = classifyReply({ from: 'Tom Weiss <tom.weiss@initech.example>', subject: 'Interview', received_at: '2026-03-10T08:00:00Z',
    body_snippet: 'Thank you for applying. See you on 12.03.2026 at 10:30 am: https://teams.microsoft.com/l/meetup-join/abc' });
  assert.equal(r.type, 'Interview');
  assert.ok(r.evidence.some((e) => /proposed time 2026-03-12 10:30/.test(e)), r.evidence.join('; '));
});

test('analyzeInvite: an invite promoted by the evidence pass still gets length-not-stated', () => {
  const d = new Date(Date.now() + 5 * 864e5);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const r = analyzeInvite(`Hi Alex, here is the link for our call on ${date} at 10:30 am: https://teams.microsoft.com/l/meetup-join/abc`, [], { clarificationDraft: false });
  assert.equal(r.classification, 'invite');
  assert.ok(r.constraints.some((c) => c.key === 'length-not-stated'));
});
