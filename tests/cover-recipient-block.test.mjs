// tests/cover-recipient-block.test.mjs — {{RECIPIENT_BLOCK}} must be fillable.
//
// The pack authoring contract lists {{RECIPIENT_BLOCK}} among the required
// cover-letter slots, but generate-cover-letter.mjs never filled it, so every
// pack cover template died at substitution with
// "Unresolved placeholders: {{RECIPIENT_BLOCK}}".
//
// The failure is worth a test rather than a one-line map entry because of how it
// presented: validateTemplate (KINDS.cover) requires only NAME, ROLE_TITLE and
// OPENING, so a pack template PASSED the validator and then exploded in the
// substitution pass. A green gate followed by a hard failure is the shape that
// makes an author distrust the gate, so both halves are pinned here: the slot
// fills, and an absent recipient is not an error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../generate-cover-letter.mjs';

/** A minimal template carrying the pack's recipient slot. */
function packTemplate() {
  const dir = mkdtempSync(join(tmpdir(), 'cover-recipient-'));
  const file = join(dir, 'cover-letter-template.html');
  writeFileSync(file, '{{NAME}}{{ROLE_TITLE}}{{DATELINE}}{{RECIPIENT_BLOCK}}{{OPENING}}{{PROFILE_INTRO}}');
  return file;
}

const base = (recipient) => ({
  candidate: { name: 'A Candidate' },
  letter: {
    role_title: 'Head of Marketing',
    opening: 'Opening line.',
    profile_intro: 'Profile intro.',
    ...(recipient === undefined ? {} : { recipient }),
  },
});

test('a template carrying {{RECIPIENT_BLOCK}} renders instead of throwing', () => {
  // Given the exact shape the pack contract publishes: name, title, company,
  // then address_lines
  const html = buildHtml(base({
    name: 'Jane Reviewer',
    title: 'Director of Talent',
    company: 'Example Corp',
    address_lines: ['100 Example Street', 'Springfield, IL 62704'],
  }), packTemplate());

  // Then every supplied part reaches the output...
  for (const part of ['Jane Reviewer', 'Director of Talent', 'Example Corp', '100 Example Street', 'Springfield, IL 62704']) {
    assert.ok(html.includes(part), `recipient block must carry "${part}"`);
  }
  // ...and the token itself is gone
  assert.ok(!html.includes('{{RECIPIENT_BLOCK}}'), 'the slot must be substituted, not left literal');
});

test('the recipient block is self-wrapped, one div per line', () => {
  // The contract is explicit that the filler emits its own wrapper and that the
  // template places the placeholder bare, so a <br>-joined string would not do.
  const html = buildHtml(base({ name: 'Jane Reviewer', company: 'Example Corp' }), packTemplate());

  assert.match(html, /<div class="recipient">/, 'the block wraps itself');
  assert.match(html, /<div>Jane Reviewer<\/div>/);
  assert.match(html, /<div>Example Corp<\/div>/);
});

test('an absent recipient renders empty, and is not an error', () => {
  // Most letters have no addressee. That must stay a rendered letter, not a
  // failed render, or this fix trades one hard failure for another.
  const html = buildHtml(base(undefined), packTemplate());

  assert.ok(!html.includes('{{RECIPIENT_BLOCK}}'), 'the slot is still substituted');
  assert.ok(!html.includes('class="recipient"'), 'no empty wrapper is emitted');
});

test('a recipient with no usable fields renders empty rather than an empty wrapper', () => {
  const html = buildHtml(base({ name: '', company: '', address_lines: [] }), packTemplate());
  assert.ok(!html.includes('class="recipient"'));
});

test('recipient values are HTML-escaped', () => {
  // The recipient comes from a payload an agent wrote from a job posting, which
  // is untrusted content by the project's own rule.
  const html = buildHtml(base({ name: '<script>alert(1)</script>', company: 'A & B' }), packTemplate());

  assert.ok(!html.includes('<script>'), 'a script tag must not survive into the letter');
  assert.match(html, /A &amp; B/);
});
