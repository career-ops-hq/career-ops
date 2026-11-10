// tests/cover-shipped-recipient.test.mjs — the shipped cover-letter template
// carries the {{RECIPIENT_BLOCK}} slot (#5937).
//
// buildRecipientBlock fills the slot only where the loaded template has one.
// The shipped template had none, so a payload's letter.recipient was dropped
// without a warning for anyone not on a template pack. These tests render both
// cases through templates/cover-letter-template.html itself, not a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../generate-cover-letter.mjs';

const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'cover-letter-template.html');

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

const count = (html, needle) => html.split(needle).length - 1;

test('a recipient renders through the shipped template', () => {
  const html = buildHtml(payload({
    recipient: { name: 'Jane Reviewer', title: 'Director of Talent', address_lines: ['100 Example Street', 'Boston, MA 02101'] },
  }), SHIPPED);

  for (const part of ['Jane Reviewer', 'Director of Talent', '100 Example Street']) {
    assert.ok(html.includes(part), `shipped template must render "${part}"`);
  }
  assert.match(html, /<div class="recipient">/);
  assert.ok(!html.includes('{{'), 'no placeholder may be left behind');
});

test('with a recipient the company prints once', () => {
  const html = buildHtml(payload({
    recipient: { name: 'Jane Reviewer', address_lines: ['100 Example Street'] },
  }), SHIPPED);

  assert.ok(html.includes('Jane Reviewer'), 'the block must render, or the count below proves nothing');
  assert.equal(count(html, 'Example Corp'), 1);
});

test('without a recipient no address block is emitted', () => {
  const html = buildHtml(payload({}), SHIPPED);

  assert.ok(!html.includes('<div class="recipient">'), 'no wrapper for an absent recipient');
  assert.ok(!html.includes('{{'), 'no placeholder may be left behind');
  assert.match(html, /Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026/);
});

test('a blank recipient behaves like an absent one', () => {
  const html = buildHtml(payload({ recipient: { name: '   ', company: '\t' } }), SHIPPED);

  assert.ok(!html.includes('<div class="recipient">'));
  assert.match(html, /Example Corp &nbsp;&nbsp; Boston, MA &nbsp;&nbsp; September 8, 2026/);
});
