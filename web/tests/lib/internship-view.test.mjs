import assert from 'node:assert/strict';
import test from 'node:test';

// These tests exercise the internship view-layer logic inline,
// since the route module uses Next.js path aliases.

/** Parse extended fields from the Notes column. Tags are "key:value" separated by " | ". */
function parseNoteTags(notes) {
  const tags = {};
  const parts = notes.split(' | ');
  const plainParts = [];
  for (const part of parts) {
    const m = part.match(/^(\w+):(.+)$/);
    if (m) {
      tags[m[1]] = m[2].trim();
    } else {
      plainParts.push(part);
    }
  }
  tags._plain = plainParts.join(' | ');
  return tags;
}

/** Encode extended fields back into Notes tags. */
function encodeNoteTags(fields, plainNotes) {
  const parts = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val) parts.push(`${key}:${val}`);
  }
  if (plainNotes) parts.push(plainNotes);
  return parts.join(' | ');
}

const STATUS_TO_CANONICAL = {
  wishlist: 'Evaluated',
  applied: 'Applied',
  interviewing: 'Interview',
  offered: 'Offer',
  rejected: 'Rejected',
  accepted: 'Hired',
  closed: 'Discarded',
  not_posted: 'SKIP',
  unknown: 'Evaluated',
};

const CANONICAL_TO_STATUS = {
  Evaluated: 'wishlist',
  Applied: 'applied',
  Responded: 'applied',
  Interview: 'interviewing',
  Offer: 'offered',
  Hired: 'accepted',
  Rejected: 'rejected',
  Discarded: 'closed',
  SKIP: 'not_posted',
};

function appToInternship(app) {
  const tags = parseNoteTags(app.notes);
  return {
    id: app.n,
    company: app.company,
    role: app.role,
    location: app.location,
    status: CANONICAL_TO_STATUS[app.status] ?? 'unknown',
    dateAdded: app.date,
    url: app.applyLink || undefined,
    notes: tags._plain || '',
    score: app.score || undefined,
    track: tags.track,
    source: tags.source,
    requirements: tags.requirements,
    deadline: tags.deadline,
    workAuth: tags.workAuth,
    gradEligibility: tags.gradEligibility,
  };
}

// --- parseNoteTags ---

test('parseNoteTags: extracts tagged fields', () => {
  const result = parseNoteTags('track:DS | source:simplify-github | Posted:3d ago');
  assert.equal(result.track, 'DS');
  assert.equal(result.source, 'simplify-github');
  assert.equal(result.Posted, '3d ago');
  assert.equal(result._plain, '');
});

test('parseNoteTags: non-tag colon patterns become plain text', () => {
  const result = parseNoteTags('track:DS | some note with no tags');
  assert.equal(result.track, 'DS');
  assert.equal(result._plain, 'some note with no tags');
});

test('parseNoteTags: handles plain-only notes', () => {
  const result = parseNoteTags('Just some notes');
  assert.equal(result._plain, 'Just some notes');
  assert.equal(result.track, undefined);
});

test('parseNoteTags: handles empty string', () => {
  const result = parseNoteTags('');
  assert.equal(result._plain, '');
});

test('parseNoteTags: handles multiple plain parts', () => {
  const result = parseNoteTags('track:SWE | Good company | Remote friendly');
  assert.equal(result.track, 'SWE');
  assert.equal(result._plain, 'Good company | Remote friendly');
});

// --- encodeNoteTags ---

test('encodeNoteTags: encodes fields with plain notes', () => {
  const result = encodeNoteTags({ track: 'DS', source: 'github' }, 'Good fit');
  assert.equal(result, 'track:DS | source:github | Good fit');
});

test('encodeNoteTags: skips undefined/empty fields', () => {
  const result = encodeNoteTags({ track: 'DS', source: undefined, deadline: '' }, '');
  assert.equal(result, 'track:DS');
});

test('encodeNoteTags: handles no fields and no notes', () => {
  const result = encodeNoteTags({}, '');
  assert.equal(result, '');
});

// --- Status mapping ---

test('STATUS_TO_CANONICAL: maps all UI statuses', () => {
  assert.equal(STATUS_TO_CANONICAL['wishlist'], 'Evaluated');
  assert.equal(STATUS_TO_CANONICAL['applied'], 'Applied');
  assert.equal(STATUS_TO_CANONICAL['interviewing'], 'Interview');
  assert.equal(STATUS_TO_CANONICAL['offered'], 'Offer');
  assert.equal(STATUS_TO_CANONICAL['rejected'], 'Rejected');
  assert.equal(STATUS_TO_CANONICAL['accepted'], 'Hired');
  assert.equal(STATUS_TO_CANONICAL['closed'], 'Discarded');
  assert.equal(STATUS_TO_CANONICAL['not_posted'], 'SKIP');
});

test('CANONICAL_TO_STATUS: maps all canonical states', () => {
  assert.equal(CANONICAL_TO_STATUS['Evaluated'], 'wishlist');
  assert.equal(CANONICAL_TO_STATUS['Applied'], 'applied');
  assert.equal(CANONICAL_TO_STATUS['Responded'], 'applied');
  assert.equal(CANONICAL_TO_STATUS['Interview'], 'interviewing');
  assert.equal(CANONICAL_TO_STATUS['Offer'], 'offered');
  assert.equal(CANONICAL_TO_STATUS['Hired'], 'accepted');
  assert.equal(CANONICAL_TO_STATUS['Rejected'], 'rejected');
  assert.equal(CANONICAL_TO_STATUS['Discarded'], 'closed');
  assert.equal(CANONICAL_TO_STATUS['SKIP'], 'not_posted');
});

// --- appToInternship ---

test('appToInternship: converts Application to Internship with tagged notes', () => {
  const app = {
    n: '42',
    date: '2026-10-01',
    company: 'Acme Corp',
    role: 'Data Scientist Intern',
    location: 'Remote',
    score: '4.2/5',
    status: 'Applied',
    pdf: '✅',
    report: '[042](reports/042-acme.md)',
    applyLink: 'https://acme.com/apply',
    notes: 'track:DS | source:simplify-github | Great opportunity',
    via: '',
    followUp: '',
  };

  const result = appToInternship(app);
  assert.equal(result.id, '42');
  assert.equal(result.company, 'Acme Corp');
  assert.equal(result.role, 'Data Scientist Intern');
  assert.equal(result.status, 'applied');
  assert.equal(result.track, 'DS');
  assert.equal(result.source, 'simplify-github');
  assert.equal(result.notes, 'Great opportunity');
  assert.equal(result.url, 'https://acme.com/apply');
  assert.equal(result.score, '4.2/5');
});

test('appToInternship: unknown canonical status maps to unknown', () => {
  const app = {
    n: '1', date: '2026-10-01', company: 'X', role: 'Y',
    location: '', score: '', status: 'SomeNewState', pdf: '',
    report: '', applyLink: '', notes: '', via: '', followUp: '',
  };
  assert.equal(appToInternship(app).status, 'unknown');
});

test('appToInternship: empty applyLink becomes undefined', () => {
  const app = {
    n: '1', date: '2026-10-01', company: 'X', role: 'Y',
    location: '', score: '', status: 'Evaluated', pdf: '',
    report: '', applyLink: '', notes: '', via: '', followUp: '',
  };
  assert.equal(appToInternship(app).url, undefined);
});

// --- Round-trip: encode then parse ---

test('note tags round-trip: encode then parse preserves data', () => {
  const fields = { track: 'BIE', source: 'scan', requirements: 'Python SQL' };
  const plain = 'Looks promising';
  const encoded = encodeNoteTags(fields, plain);
  const parsed = parseNoteTags(encoded);
  assert.equal(parsed.track, 'BIE');
  assert.equal(parsed.source, 'scan');
  assert.equal(parsed.requirements, 'Python SQL');
  assert.equal(parsed._plain, 'Looks promising');
});
