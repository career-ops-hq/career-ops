// tests/cv-markdown-bold-line.test.mjs — boldLineText() only accepts a line
// that is bold from end to end (#4879).
//
// The regex `^(\*\*|__)(.+?)\1\s*$` let the lazy group grow past the first
// closing marker, so `**Title** · **2020**` (two bold runs with plain text
// between them) was read as ONE bold span and came back as "Title · 2020".
// cv-title-check.mjs takes that value as the entry's job title.
//
// Run:  node --test tests/cv-markdown-bold-line.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boldLineText, normalizePandocLine } from '../lib/cv-markdown.mjs';
import { parseCvExperience } from '../cv-title-check.mjs';

test('a line bold from end to end yields its plain text', () => {
  assert.equal(boldLineText('**Senior Engineer**'), 'Senior Engineer');
  assert.equal(boldLineText('__Senior Engineer__'), 'Senior Engineer');
  assert.equal(boldLineText('**Senior Engineer**  '), 'Senior Engineer');
});

test('two bold runs separated by plain text are not one bold line', () => {
  assert.equal(boldLineText('**Title** · **2020**'), null);
  assert.equal(boldLineText('**Senior Engineer** | **Acme**'), null);
  assert.equal(boldLineText('**A** **B**'), null);
  assert.equal(boldLineText('__A__ and __B__'), null);
});

test('a line that is only partly bold is still not a title line', () => {
  assert.equal(boldLineText('**Title** · 2020'), null);
  assert.equal(boldLineText('Title **2020**'), null);
});

test('the other delimiter and escaped markers inside a bold line are kept', () => {
  assert.equal(boldLineText('**Lead __Platform__ Engineer**'), 'Lead Platform Engineer');
  assert.equal(boldLineText('**Costs \\*\\*extra\\*\\***'), 'Costs **extra**');
});

test('a Pandoc hard break after the bold run still parses', () => {
  assert.equal(boldLineText(normalizePandocLine('**Senior Engineer**\\')), 'Senior Engineer');
});

test('cv-title-check does not take a two-run line as the job title', () => {
  const cvText = [
    '## Experience',
    '',
    '### Acme — Remote',
    '**Senior Engineer** | **Acme**',
    '2020 – 2024',
    '',
  ].join('\n');
  assert.deepEqual(parseCvExperience(cvText), []);
});
