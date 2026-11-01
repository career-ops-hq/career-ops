import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../generate-cover-letter.mjs';

const baseTemplate = './templates/cover-letter-template.html';

const validCandidate = { name: 'Jane Doe' };
const validLetter = {
  role_title: 'Software Engineer',
  opening: 'I am excited to apply for the Software Engineer role.',
  profile_intro: 'With extensive engineering background...',
};

test('buildHtml throws on missing or non-object candidate or letter', () => {
  assert.throws(
    () => buildHtml(null, baseTemplate),
    /Missing required field: payload\.candidate/
  );
  assert.throws(
    () => buildHtml({}, baseTemplate),
    /Missing required field: payload\.candidate/
  );
  assert.throws(
    () => buildHtml({ candidate: null, letter: validLetter }, baseTemplate),
    /Missing required field: payload\.candidate/
  );
  assert.throws(
    () => buildHtml({ candidate: validCandidate, letter: null }, baseTemplate),
    /Missing required field: payload\.letter/
  );
});

test('buildHtml rejects empty, null, or whitespace-only candidate.name', () => {
  const badNames = [null, undefined, '', '   ', 123, {}];
  for (const name of badNames) {
    assert.throws(
      () => buildHtml({ candidate: { name }, letter: validLetter }, baseTemplate),
      /Missing required field: candidate\.name/,
      `expected candidate.name=${JSON.stringify(name)} to throw`
    );
  }
});

test('buildHtml rejects empty, null, or whitespace-only required letter fields', () => {
  const requiredFields = ['role_title', 'opening', 'profile_intro'];
  const badValues = [null, undefined, '', '   ', 42, {}];

  for (const field of requiredFields) {
    for (const val of badValues) {
      const letter = { ...validLetter, [field]: val };
      assert.throws(
        () => buildHtml({ candidate: validCandidate, letter }, baseTemplate),
        new RegExp(`Missing required field: letter\\.${field}`),
        `expected letter.${field}=${JSON.stringify(val)} to throw`
      );
    }
  }
});

test('buildHtml succeeds when all required fields are valid non-empty strings', () => {
  const html = buildHtml({ candidate: validCandidate, letter: validLetter }, baseTemplate);
  assert.ok(html.includes('Jane Doe'));
  assert.ok(html.includes('Software Engineer'));
  assert.ok(html.includes('I am excited to apply'));
});
