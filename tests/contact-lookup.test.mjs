// tests/contact-lookup.test.mjs — coverage for contact-lookup.mjs (#4691)
//
// `contacto` checks data/contacts.tsv for a saved contact at the SAME company
// before running a cold WebSearch, so a prior interviewer or a contact from
// an earlier, different-role application surfaces as an internal-referral
// lead instead of being searched for again. This covers:
//   - findContactsByCompany(): exact + normalized (case/punctuation-folded)
//     matching, order (most-recently-listed first), no-match and
//     empty/placeholder-query guards
//   - the CLI: --company (JSON/--summary), missing operand, --self-test,
//     --help, unknown flag
//   - contacts.mjs's VALID_TYPES now accepting `internal-referral`
//
// Fictional names/companies throughout — data/contacts.tsv is user-layer,
// gitignored third-party PII and no fixture here resembles anyone real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findContactsByCompany } from '../contact-lookup.mjs';
import { parseContacts } from '../contacts.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(CODE_ROOT, 'contact-lookup.mjs');

const row = (cells) => cells.join('\t');

const FIXTURE = [
  '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes',
  row(['Priya Shah', 'Northwind Robotics', 'interviewer', 'Eng Director', '', 'priya@northwind.example', '', '014', 'interviewed me for the Platform Eng role, Feb 2026']),
  row(['Devon Ward', 'Globex Logistics', 'peer', '', '', 'devon@globex.example', '', '-', 'met via meetup']),
  row(['Old Priya', 'Northwind Robotics', 'recruiter', 'Former Recruiter', '', '', '', '007', 'older saved line, same company']),
].join('\n');

// --- 1. findContactsByCompany() ---------------------------------------------

test('findContactsByCompany: exact company name matches all rows at that company', () => {
  const { contacts } = parseContacts(FIXTURE);
  const matches = findContactsByCompany(contacts, 'Northwind Robotics');
  assert.equal(matches.length, 2);
});

test('findContactsByCompany: normalized match tolerates case/punctuation differences', () => {
  const { contacts } = parseContacts(FIXTURE);
  // Same normalizeCompany() key as "Northwind Robotics" — case-folded, comma added.
  const matches = findContactsByCompany(contacts, 'NORTHWIND, Robotics');
  assert.equal(matches.length, 2);
});

test('findContactsByCompany: most-recently-listed row comes first', () => {
  const { contacts } = parseContacts(FIXTURE);
  const matches = findContactsByCompany(contacts, 'Northwind Robotics');
  assert.equal(matches[0].name, 'Old Priya');
  assert.equal(matches[1].name, 'Priya Shah');
});

test('findContactsByCompany: a company with no saved contact returns an empty array', () => {
  const { contacts } = parseContacts(FIXTURE);
  assert.deepEqual(findContactsByCompany(contacts, 'Initech Holdings'), []);
});

test('findContactsByCompany: a distinct company never leaks a match from another', () => {
  const { contacts } = parseContacts(FIXTURE);
  const matches = findContactsByCompany(contacts, 'Globex Logistics');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'Devon Ward');
});

test('findContactsByCompany: empty query never matches every row', () => {
  const { contacts } = parseContacts(FIXTURE);
  assert.deepEqual(findContactsByCompany(contacts, ''), []);
});

test('findContactsByCompany: "?" placeholder query never matches every row', () => {
  const { contacts } = parseContacts(FIXTURE);
  assert.deepEqual(findContactsByCompany(contacts, '?'), []);
});

// --- 2. internal-referral type (contacts.mjs VALID_TYPES) -------------------

test('parseContacts: internal-referral is a recognized type, not flagged off-enum', () => {
  const content = row(['Priya Shah', 'Northwind Robotics', 'internal-referral', 'Eng Director', '', '', '', '014', '']);
  const { contacts, quality } = parseContacts(content);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].type, 'internal-referral');
  assert.deepEqual(quality.invalidTypes, []);
});

test('parseContacts: internal-referral is distinct from peer (both still valid, not merged)', () => {
  const content = [
    row(['A', 'Acme', 'peer', '', '', '', '', '-', '']),
    row(['B', 'Acme', 'internal-referral', '', '', '', '', '-', '']),
  ].join('\n');
  const { contacts, quality } = parseContacts(content);
  assert.equal(contacts.length, 2);
  assert.deepEqual(quality.invalidTypes, []);
  assert.equal(contacts[0].type, 'peer');
  assert.equal(contacts[1].type, 'internal-referral');
});

// --- 3. CLI ------------------------------------------------------------------

function seedDataRoot() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-contact-lookup-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'contacts.tsv'), FIXTURE);
  return dataRoot;
}

function runLookup(dataRoot, args) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  delete env.CAREER_OPS_DATA_DIR;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 30_000,
  });
}

test('CLI --company: JSON output lists matches at the queried company', () => {
  const dataRoot = seedDataRoot();
  try {
    const result = runLookup(dataRoot, ['--company', 'Northwind Robotics']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.company, 'Northwind Robotics');
    assert.equal(parsed.total, 2);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('CLI --company --summary: human-readable output names the contact and tracker#', () => {
  const dataRoot = seedDataRoot();
  try {
    const result = runLookup(dataRoot, ['--company', 'Northwind Robotics', '--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SAVED CONTACTS @ Northwind Robotics/);
    assert.match(result.stdout, /Priya Shah/);
    assert.match(result.stdout, /tracker #014/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('CLI --company: no match reports zero results, not an error', () => {
  const dataRoot = seedDataRoot();
  try {
    const result = runLookup(dataRoot, ['--company', 'Initech Holdings']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.total, 0);
    assert.deepEqual(parsed.matches, []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('CLI: missing --company value is a usage error, not a silent default', () => {
  const dataRoot = seedDataRoot();
  try {
    const result = runLookup(dataRoot, ['--company']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--company requires a value/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('CLI: --company omitted entirely is a usage error', () => {
  const dataRoot = seedDataRoot();
  try {
    const result = runLookup(dataRoot, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--company is required/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('CLI: --self-test exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--self-test'], { cwd: CODE_ROOT, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /contact-lookup self-test OK/);
});

test('CLI: --help exits 0 and prints Usage', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: CODE_ROOT, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('CLI: unknown flag exits 1 and names the bad flag', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--bogus'], { cwd: CODE_ROOT, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--bogus/);
});

test('CLI: a company with no saved contacts.tsv at all answers empty, not a crash', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-contact-lookup-empty-'));
  try {
    const result = runLookup(dataRoot, ['--company', 'Anyone']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.total, 0);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

// --- 4. modes/contacto.md wiring (#4691) ------------------------------------
// Moved here from test-all.mjs's inline checks (CodeRabbit, PR #4692): inline
// checks are skipped by `--only`, while files under tests/ are auto-discovered.

test('contacto checks for a saved contact at the same company before a cold WebSearch', () => {
  const contactoModeDoc = readFileSync(join(CODE_ROOT, 'modes', 'contacto.md'), 'utf-8');
  assert.match(contactoModeDoc, /contact-lookup\.mjs/, 'should reference contact-lookup.mjs');
  assert.match(contactoModeDoc, /internal-referral/, 'should reference the internal-referral contact type');
  assert.match(contactoModeDoc, /Internal Referral/, 'should define the Internal Referral persona');

  // Ordering: the saved-contact check must come before step 1's WebSearch,
  // not just be mentioned somewhere in the document.
  const lookupIndex = contactoModeDoc.indexOf('contact-lookup.mjs');
  const webSearchIndex = contactoModeDoc.indexOf('Find ONE target** via WebSearch');
  assert.ok(lookupIndex >= 0 && webSearchIndex >= 0, 'both anchors must exist in the doc');
  assert.ok(
    lookupIndex < webSearchIndex,
    'contact-lookup.mjs check must appear before step 1\'s WebSearch target discovery'
  );

  // Fallback: both the decline branch and the no-match branch must continue
  // to step 1 as normal — neither should dead-end the flow.
  assert.match(
    contactoModeDoc,
    /declines.*?continue to step 1 as normal/s,
    'declining the saved-contact offer must fall through to step 1 unchanged'
  );
  assert.match(
    contactoModeDoc,
    /no match exists.*?continue straight to step 1/s,
    'no saved-contact match must fall through to step 1 unchanged'
  );
});

test('contacto does not auto-reclassify a saved contact to internal-referral on a company match alone', () => {
  const contactoModeDoc = readFileSync(join(CODE_ROOT, 'modes', 'contacto.md'), 'utf-8');
  // CodeRabbit (PR #4692): a step-0 match surfaced purely by normalized
  // company (contact-lookup.mjs's findContactsByCompany) must not silently
  // overwrite a saved `peer` row's type -- `peer` explicitly documents NO
  // prior relationship, so flipping it to `internal-referral` on a company
  // match + "sure, reach out" would misrepresent the relationship.
  assert.match(
    contactoModeDoc,
    /only once the candidate\s+has confirmed a real prior relationship/s,
    'reclassifying a step-0 contact to internal-referral must require explicit relationship confirmation, not just a company match'
  );
  assert.match(
    contactoModeDoc,
    /saved as `peer` explicitly assumed NO prior relationship/,
    'must call out that a saved peer row is not retroactively real just because it surfaced in step 0'
  );
});
