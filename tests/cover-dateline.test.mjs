// tests/cover-dateline.test.mjs — {{DATELINE}} carries the date, not the address.
//
// The pack authoring contract fixes both the order and the contents:
//
//   {{DATELINE}}                        # the date
//   {{RECIPIENT_BLOCK}}                 # recipient address block, or empty
//   Re: Application for {{ROLE_TITLE}}  # reference line
//   {{GREETING_BLOCK}}                  # salutation
//
// buildDateline joined company + city + date, so a letter that renders a
// recipient printed the company twice, three lines apart. The join is correct
// for the shipped base template, which has no address block and would otherwise
// lose that context entirely, so this is a gate rather than a replacement.
//
// The absent-recipient case is the one that protects every existing payload:
// nothing today sets letter.recipient, so nothing today changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../generate-cover-letter.mjs';

function template() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-dateline-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, '{{NAME}}{{ROLE_TITLE}}[D]{{DATELINE}}[/D]{{RECIPIENT_BLOCK}}{{OPENING}}{{PROFILE_INTRO}}');
  return file;
}

/** Just the dateline slot's rendered contents. */
const dateline = (html) => html.slice(html.indexOf('[D]') + 3, html.indexOf('[/D]'));

const payload = (extra) => ({
  candidate: { name: 'A Candidate' },
  letter: {
    role_title: 'Head of Marketing',
    opening: 'Opening line.',
    profile_intro: 'Profile intro.',
    company: 'Example Corp',
    city: 'Boston, MA',
    date: 'September 8, 2026',
    ...extra,
  },
});

test('with a recipient, the dateline carries the date alone', () => {
  // Given the address block below it already names the company and city
  const html = buildHtml(payload({
    recipient: { name: 'Jane Reviewer', company: 'Example Corp', address_lines: ['Boston, MA'] },
  }), template());
  const d = dateline(html);

  assert.equal(d, 'September 8, 2026');
  assert.ok(!d.includes('Example Corp'), 'the company belongs to the address block, not the dateline');
  assert.ok(!d.includes('Boston, MA'), 'the city belongs to the address block, not the dateline');
  // And it is still present exactly once in the letter as a whole
  assert.equal((html.match(/Example Corp/g) || []).length, 1, 'the company appears once, not twice');
});

test('with no recipient, the dateline is unchanged', () => {
  // This is the compatibility guarantee: no payload today sets a recipient, so
  // no payload today renders differently.
  const d = dateline(buildHtml(payload({}), template()));

  assert.equal(d, 'Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026');
});

test('an empty recipient object does not trigger the gate', () => {
  // buildRecipientBlock renders nothing for this, so the dateline must keep the
  // company and city rather than dropping them into a block that never appears.
  const d = dateline(buildHtml(payload({ recipient: {} }), template()));

  assert.equal(d, 'Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026');
});

test('a whitespace-only recipient does not trigger the gate either', () => {
  const d = dateline(buildHtml(payload({ recipient: { name: '   ', company: '\t' } }), template()));

  assert.equal(d, 'Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026');
});
