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

/**
 * A template carrying every contract slot, each tagged so it can be located.
 *
 * The wrapper is a `<section>`, not a `<div>`: several slots are filled with a
 * block that contains its own nested `<div>`s (RECIPIENT_BLOCK emits one per
 * address line), so a `<div>` wrapper cannot be closed unambiguously by a
 * regex. No filler emits `</section>`, so that tag pairs exactly.
 */
function packTemplate() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-pack-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, CONTRACT_SLOTS.map((s) => `<section data-slot="${s}">{{${s}}}</section>`).join('\n'));
  return file;
}

/**
 * A payload that populates every field the contract's slots are fed from.
 *
 * Every value is a distinct sentinel. Two fields sharing a value (the old
 * fixture used "Example Corp" for both `letter.company` and
 * `recipient.company`, and "Boston, MA" for both `candidate.location` and
 * `letter.city`) makes them indistinguishable in the output, so an assertion
 * covers neither side: whichever slot still renders satisfies the check for
 * both.
 */
const FULL = {
  candidate: {
    name: 'NAME-SENTINEL',
    email: 'EMAIL-SENTINEL@example.com',
    phone: '+1 555 0100 PHONE-SENTINEL',
    location: 'LOCATION-SENTINEL',
    linkedin: 'linkedin.com/in/LINKEDIN-SENTINEL',
    website: 'example.com',
    credentials: ['CRED-ONE-SENTINEL', 'CRED-TWO-SENTINEL'],
  },
  letter: {
    role_title: 'ROLE-TITLE-SENTINEL',
    company: 'LETTER-COMPANY-SENTINEL',
    city: 'LETTER-CITY-SENTINEL',
    date: 'DATE-SENTINEL',
    recipient: {
      name: 'RECIPIENT-NAME-SENTINEL',
      title: 'RECIPIENT-TITLE-SENTINEL',
      company: 'RECIPIENT-COMPANY-SENTINEL',
      address_lines: ['ADDRESS-LINE-SENTINEL'],
    },
    greeting: 'GREETING-SENTINEL',
    opening: 'OPENING-SENTINEL',
    profile_intro: 'PROFILE-INTRO-SENTINEL',
    achievements: [{ lead: 'ACH-LEAD-SENTINEL', impact: 'ACH-IMPACT-SENTINEL' }],
    problems_section: 'PROBLEMS-SENTINEL',
    closing: 'CLOSING-SENTINEL',
    language_closing: 'LANGUAGE-CLOSING-SENTINEL',
    signature: { valediction: 'Sincerely,' },
    footnotes: ['FOOTNOTE-SENTINEL'],
  },
};

/** Each populated payload value, paired with the one slot that must carry it. */
const SLOT_VALUES = [
  ['NAME', FULL.candidate.name],
  ['ROLE_TITLE', FULL.letter.role_title],
  ['CONTACT_LINE', FULL.candidate.location],
  ['CONTACT_LINE', FULL.candidate.email],
  ['CONTACT_LINE', FULL.candidate.phone],
  ['CONTACT_LINE', FULL.candidate.linkedin],
  ['CREDENTIALS_BLOCK', FULL.candidate.credentials[0]],
  ['CREDENTIALS_BLOCK', FULL.candidate.credentials[1]],
  ['DATELINE', FULL.letter.date],
  ['RECIPIENT_BLOCK', FULL.letter.recipient.name],
  ['RECIPIENT_BLOCK', FULL.letter.recipient.title],
  ['RECIPIENT_BLOCK', FULL.letter.recipient.company],
  ['RECIPIENT_BLOCK', FULL.letter.recipient.address_lines[0]],
  ['GREETING_BLOCK', FULL.letter.greeting],
  ['OPENING', FULL.letter.opening],
  ['PROFILE_INTRO', FULL.letter.profile_intro],
  ['ACHIEVEMENTS_BLOCK', FULL.letter.achievements[0].lead],
  ['ACHIEVEMENTS_BLOCK', FULL.letter.achievements[0].impact],
  ['PROBLEMS_BLOCK', FULL.letter.problems_section],
  ['CLOSING_BLOCK', FULL.letter.closing],
  ['LANGUAGE_CLOSING_BLOCK', FULL.letter.language_closing],
  ['FOOTNOTES_BLOCK', FULL.letter.footnotes[0]],
];

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

/** The rendered contents of one slot, isolated from the rest of the letter. */
function slotHtml(html, slot) {
  const match = html.match(new RegExp(`<section data-slot="${slot}">([\\s\\S]*?)</section>`));
  assert.ok(match, `rendered letter does not contain data-slot="${slot}"`);
  return match[1];
}

test('every value the payload supplies reaches its own slot', () => {
  // Substitution alone is not enough: {{ACHIEVEMENTS_BLOCK}} was "filled" with
  // empty <li> elements for the whole life of the achievements-shape bug.
  //
  // Each value is asserted INSIDE its slot, never against the whole document.
  // A document-wide `html.includes(v)` cannot tell which slot rendered a value,
  // so a slot that dropped its input still passes whenever the same string
  // survives somewhere else — the reason a RECIPIENT_BLOCK that dropped the
  // recipient name used to pass here, rescued by the greeting carrying it.
  const html = buildHtml(FULL, packTemplate());

  for (const [slot, value] of SLOT_VALUES) {
    assert.ok(slotHtml(html, slot).includes(value),
      `${slot} does not carry the payload value "${value}"`);
  }
});
// The dateline's own behaviour is NOT pinned here. It belongs to the change
// that introduces the gate, and tests/cover-dateline.test.mjs on that branch
// covers it across 8 cases including this one. Asserting it here as well
// would red this suite until that lands, for a rule this suite does not own.
// This file pins the placeholder contract a pack template can rely on.


test('the contract list and the renderer have not drifted apart', () => {
  // The canary. If someone adds a slot to the contract and not to core, the
  // suite above fails. If core grows a slot the contract does not declare, this
  // reports it as informational rather than failing, since core is allowed a
  // superset for its own shipped template.
  const html = buildHtml(FULL, packTemplate());
  const literal = [...html.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);

  assert.deepEqual(literal, [], `unsubstituted tokens survived into the letter: ${literal.join(', ')}`);
});
