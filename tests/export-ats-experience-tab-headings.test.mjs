// A tab after ### is a legal heading separator, so two experience entries
// separated that way must keep their own bullets.
//
// Run: node --test tests/export-ats-experience-tab-headings.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCvMarkdown } from '../scripts/export-ats-text.mjs';

const CV = `## Experience

###\tAcme -- NYC

**Staff Engineer**
Jan 2020 - Present

- Cut cost 50%.

###\tInitech -- Remote

**Engineer**
09/2021 - Present

- Did the work.
`;

test('tab-separated experience headings keep each job its own bullets', () => {
  const { experience } = parseCvMarkdown(CV);
  assert.equal(experience.length, 2);
  assert.deepEqual(experience[0].bullets, ['Cut cost 50%.']);
  assert.deepEqual(experience[1].bullets, ['Did the work.']);
});
