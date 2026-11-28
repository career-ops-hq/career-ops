import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCvMarkdown } from '../scripts/export-ats-text.mjs';

test('a tab after ## keeps sections and their entries separate', () => {
  const parsed = parseCvMarkdown(`##\tExperience

###\tAcme

**Engineer**
2020-2024

- Built things.

##\tProjects

###\tSide Project

- Did stuff.
`);
  assert.equal(parsed.experience.length, 1);
  assert.equal(parsed.experience[0].company, 'Acme');
  assert.deepEqual(parsed.experience[0].bullets, ['Built things.']);
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].name, 'Side Project');
  assert.deepEqual(parsed.projects[0].bullets, ['Did stuff.']);
});
