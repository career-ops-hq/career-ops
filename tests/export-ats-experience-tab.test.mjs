import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCvMarkdown } from '../scripts/export-ats-text.mjs';

test('a tab after ### keeps each experience entry with its own bullets', () => {
  const parsed = parseCvMarkdown(`## Experience

###\tAcme

**Staff Engineer**
2020-2024

- Cut cost 50%.

###\tInitech

**Engineer**
09/2021 - Present

- Did the work.
`);
  assert.equal(parsed.experience.length, 2);
  assert.equal(parsed.experience[0].company, 'Acme');
  assert.deepEqual(parsed.experience[0].bullets, ['Cut cost 50%.']);
  assert.equal(parsed.experience[1].company, 'Initech');
  assert.deepEqual(parsed.experience[1].bullets, ['Did the work.']);
});
