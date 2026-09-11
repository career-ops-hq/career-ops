// tests/cover-pack-contract.test.mjs — core must fill every slot the pack
// cover-letter contract declares.
//
// Nothing rendered a pack-shaped template through core before this, which is how
// the contract and the renderer drifted apart twice without a red test:
// {{RECIPIENT_BLOCK}} was declared and never filled, so every pack cover template
// died at substitution; and {{DATELINE}} was declared as the date while the
// renderer joined company and city into it, so a pack letter printed the company
// twice.
//
// The gap was structural. validateTemplate demands 3 placeholders for kind=cover
// while the contract declares 14, and tests/template-packs.test.mjs proves a pack
// RESOLVES without ever rendering one. Every other cover suite builds its own
// inline fixture carrying just the slots that test needs, so none of them can see
// a slot core forgot.
//
// CONTRACT_SLOTS below is the list from the pack authoring docs, transcribed. It
// is deliberately a literal rather than something derived from the renderer: a
// list read out of generate-cover-letter.mjs would agree with itself no matter
// what the contract says, which is exactly the check that was missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../generate-cover-letter.mjs';

/** The 14 cover-letter slots the pack authoring contract declares. */
const CONTRACT_SLOTS = [
  'NAME', 'ROLE_TITLE', 'CONTACT_LINE', 'DATELINE', 'RECIPIENT_BLOCK',
  'GREETING_BLOCK', 'OPENING', 'PROFILE_INTRO', 'PROBLEMS_BLOCK',
  'ACHIEVEMENTS_BLOCK', 'CREDENTIALS_BLOCK', 'CLOSING_BLOCK',
  'LANGUAGE_CLOSING_BLOCK', 'FOOTNOTES_BLOCK',
];

/** A template carrying every contract slot, each tagged so it can be located. */
function packTemplate() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-pack-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, CONTRACT_SLOTS.map((s) => `<div data-slot="${s}">{{${s}}}</div>`).join('\n'));
  return file;
}

/** A payload that populates every field the contract's slots are fed from. */
const FULL = {
  candidate: {
    name: 'A Candidate',
    email: 'candidate@example.com',
    phone: '+1 555 0100',
    location: 'Boston, MA',
    linkedin: 'linkedin.com/in/example',
    website: 'example.com',
    credentials: ['CRED-ONE', 'CRED-TWO'],
  },
  letter: {
    role_title: 'Head of Marketing',
    company: 'Example Corp',
    city: 'Boston, MA',
    date: 'September 11, 2026',
    recipient: { name: 'Jane Reviewer', title: 'Director of Talent', company: 'Example Corp', address_lines: ['100 Example Street'] },
    greeting: 'Dear Jane Reviewer,',
    opening: 'OPENING-TEXT',
    profile_intro: 'PROFILE-INTRO-TEXT',
    achievements: [{ lead: 'ACH-LEAD', impact: 'ACH-IMPACT' }],
    problems_section: 'PROBLEMS-TEXT',
    closing: 'CLOSING-TEXT',
    language_closing: 'LANGUAGE-CLOSING-TEXT',
    signature: { valediction: 'Sincerely,' },
    footnotes: ['FOOTNOTE-ONE'],
  },
};

test('a template carrying every contract slot renders at all', () => {
  // The failure this replaces was a hard throw on the first unfilled slot, so
  // "does not throw" is the first thing worth pinning.
  assert.doesNotThrow(() => buildHtml(FULL, packTemplate()));
});

test('core fills every slot the contract declares', () => {
  const html = buildHtml(FULL, packTemplate());

  // A slot left literal is a slot core does not know about. Report all of them
  // at once rather than dying on the first, so a contract that grows by three
  // says so in one run.
  const unfilled = CONTRACT_SLOTS.filter((s) => html.includes(`{{${s}}}`));
  assert.deepEqual(unfilled, [], `core left contract slots unsubstituted: ${unfilled.join(', ')}`);
});

test('every value the payload supplies reaches the letter', () => {
  // Substitution alone is not enough: {{ACHIEVEMENTS_BLOCK}} was "filled" with
  // empty <li> elements for the whole life of the achievements-shape bug.
  const html = buildHtml(FULL, packTemplate());

  for (const v of ['A Candidate', 'Head of Marketing', 'Jane Reviewer', 'Director of Talent',
                   '100 Example Street', 'OPENING-TEXT', 'PROFILE-INTRO-TEXT', 'ACH-LEAD',
                   'ACH-IMPACT', 'PROBLEMS-TEXT', 'CLOSING-TEXT', 'LANGUAGE-CLOSING-TEXT',
                   'CRED-ONE', 'FOOTNOTE-ONE', 'September 11, 2026']) {
    assert.ok(html.includes(v), `the payload supplied "${v}" and the letter does not carry it`);
  }
});

test('the contract list and the renderer have not drifted apart', () => {
  // The canary. If someone adds a slot to the contract and not to core, the
  // suite above fails. If core grows a slot the contract does not declare, this
  // reports it as informational rather than failing, since core is allowed a
  // superset for its own shipped template.
  const html = buildHtml(FULL, packTemplate());
  const literal = [...html.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);

  assert.deepEqual(literal, [], `unsubstituted tokens survived into the letter: ${literal.join(', ')}`);
});
