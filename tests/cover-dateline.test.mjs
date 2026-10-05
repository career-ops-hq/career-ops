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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../generate-cover-letter.mjs';

function template() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-dateline-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, '{{NAME}}{{ROLE_TITLE}}[D]{{DATELINE}}[/D]{{RECIPIENT_BLOCK}}{{OPENING}}{{PROFILE_INTRO}}');
  return file;
}

/** A template shaped like the shipped base one: a dateline, no address block. */
function templateWithoutRecipientSlot() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-dateline-noslot-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, '{{NAME}}{{ROLE_TITLE}}[D]{{DATELINE}}[/D]{{OPENING}}{{PROFILE_INTRO}}');
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

test('a template without the slot keeps the company and city in the dateline', () => {
  // The gate's real predicate is the LOADED TEMPLATE having somewhere to put the
  // address, not the payload having address data. The shipped base template
  // (templates/cover-letter-template.html) has {{DATELINE}} and no
  // {{RECIPIENT_BLOCK}}, so gating on the payload drops the company and city
  // with nothing downstream to reprint them — the letter silently loses them.
  const d = dateline(buildHtml(payload({
    recipient: { name: 'Jane Reviewer', company: 'Example Corp', address_lines: ['Boston, MA'] },
  }), templateWithoutRecipientSlot()));

  assert.equal(d, 'Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026');
});

test('the shipped base template has no {{RECIPIENT_BLOCK}} slot', () => {
  // The premise of the test above, asserted directly: if the shipped template
  // ever gains an address block, the gate starts firing for it and this test is
  // the one that says so.
  const shipped = readFileSync(
    new URL('../templates/cover-letter-template.html', import.meta.url), 'utf-8');

  assert.ok(shipped.includes('{{DATELINE}}'), 'the shipped template has a dateline slot');
  assert.ok(!shipped.includes('{{RECIPIENT_BLOCK}}'), 'the shipped template has no address block');
});

test('a name-only recipient keeps the company and city somewhere in the letter', () => {
  // Regression. buildRecipientBlock returns a block for { name } alone, so the
  // dateline went date-only, but the block carried only the name. company and
  // city then appeared nowhere: the letter silently lost both.
  const html = buildHtml(payload({ recipient: { name: 'Jane Reviewer' } }), template());

  assert.ok(html.includes('Example Corp'), 'the company vanished from the letter');
  assert.ok(html.includes('Boston, MA'), 'the city vanished from the letter');
  // and still exactly once each, which is the duplication this PR exists to stop
  assert.equal((html.match(/Example Corp/g) || []).length, 1);
  assert.equal((html.match(/Boston, MA/g) || []).length, 1);
});

test('a recipient carrying its own company does not get it twice', () => {
  const html = buildHtml(payload({
    recipient: { name: 'Jane', company: 'Example Corp', address_lines: ['Boston, MA'] },
  }), template());
  assert.equal((html.match(/Example Corp/g) || []).length, 1);
  assert.equal((html.match(/Boston, MA/g) || []).length, 1);
});

test('a city already inside an address line is not appended again', () => {
  // The dedup compared whole lines, so "123 Main St, Boston, MA" did not match
  // the city "Boston, MA" and the city landed in the block a second time.
  const html = buildHtml(payload({
    recipient: { name: 'Jane', address_lines: ['123 Main St, Boston, MA'] },
  }), template());

  assert.equal((html.match(/Boston, MA/g) || []).length, 1, 'the city was duplicated');
  assert.equal((html.match(/Example Corp/g) || []).length, 1);
});

test('a non-string address line does not crash the render', () => {
  // filter(Boolean) kept a truthy non-string, and the case-insensitive compare
  // then called toLowerCase on it.
  const html = buildHtml(payload({
    recipient: { name: 'Jane', address_lines: [42, 'Boston, MA'] },
  }), template());

  assert.ok(html.includes('42'), 'a numeric line should still render');
  assert.equal((html.match(/Boston, MA/g) || []).length, 1);
});

test('a falsy address line is still dropped', () => {
  const html = buildHtml(payload({
    recipient: { name: 'Jane', address_lines: [0, '', null, 'Boston, MA'] },
  }), template());
  assert.ok(!/<div>0<\/div>/.test(html), '0 is not an address line');
  assert.equal((html.match(/Boston, MA/g) || []).length, 1);
});

test('a city is not duplicated when the address line carries a ZIP', () => {
  // "Boston, MA 02101" and the city "Boston, MA" differ in their last
  // component, so the contiguous-run compare missed and the city was appended
  // again. A US address with a ZIP is the ordinary case, not an edge one.
  for (const line of [
    '123 Main St, Boston, MA 02101',
    '123 Main St, Boston, MA 02101-1234',
  ]) {
    const html = buildHtml(payload({
      recipient: { name: 'Jane', address_lines: [line] },
    }), template());
    assert.ok(!/<div>Boston, MA<\/div>/.test(html), `city appended again for: ${line}`);
    // Suppressing the append is only half the job. Without this, a render that
    // loses the supplied row entirely reads as a pass: no duplicate city, and
    // no address either.
    assert.ok(html.includes(`<div>${line}</div>`), `address line missing for: ${line}`);
  }
});

test('a ZIP on its own address line still suppresses the city', () => {
  const html = buildHtml(payload({
    recipient: { name: 'Jane', address_lines: ['123 Main St', 'Boston, MA 02101'] },
  }), template());
  assert.ok(!/<div>Boston, MA<\/div>/.test(html));
  assert.ok(html.includes('<div>123 Main St</div>'), 'the street line vanished');
  assert.ok(html.includes('<div>Boston, MA 02101</div>'), 'the ZIP-bearing row must survive');
});

test('a different city is still appended even when a ZIP is present', () => {
  // The ZIP strip must not make two different places compare equal.
  const html = buildHtml(payload({
    recipient: { name: 'Jane', address_lines: ['1 Elm St, Portland, OR 97201'] },
  }), template());
  assert.ok(/<div>Boston, MA<\/div>/.test(html), 'the real city should still be added');
  assert.ok(html.includes('<div>1 Elm St, Portland, OR 97201</div>'), 'the ZIP-bearing row must survive');
});
