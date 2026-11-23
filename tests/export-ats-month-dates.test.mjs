// A CV written as "Jan 2020 - Present" or "09/2021 - Present" must paste into
// an ATS form with those dates, with the city off the company name, and with
// certifications and projects. A year-first line already survived.
//
// Run: node --test tests/export-ats-month-dates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCvMarkdown, formatAtsText } from '../scripts/export-ats-text.mjs';

const CV = `# Jane Doe

## Experience

### Acme -- NYC

**Staff Engineer**
Jan 2020 - Present

- Cut cost 50%.

### Initech -- Remote

**Engineer**
09/2021 - Present

- Did the work.

## Certifications

- CKA, CNCF (2024)

## Projects

### R&D tool

- Handles A & B.
`;

test('ATS paste keeps month dates, splits the city, and includes certifications and projects', () => {
  const parsed = parseCvMarkdown(CV);
  assert.equal(parsed.experience[0].company, 'Acme');
  assert.equal(parsed.experience[0].location, 'NYC');
  assert.equal(parsed.experience[0].duration, 'Jan 2020 - Present');
  assert.equal(parsed.experience[1].company, 'Initech');
  assert.equal(parsed.experience[1].duration, '09/2021 - Present');
  assert.deepEqual(parsed.certifications, ['CKA, CNCF (2024)']);
  assert.equal(parsed.projects[0].name, 'R&D tool');
  assert.deepEqual(parsed.projects[0].bullets, ['Handles A & B.']);

  const text = formatAtsText(parsed);
  assert.match(text, /Staff Engineer at Acme, NYC \(Jan 2020 - Present\)/);
  assert.match(text, /Engineer at Initech, Remote \(09\/2021 - Present\)/);
  assert.match(text, /--- CERTIFICATIONS ---\nCKA, CNCF \(2024\)/);
  assert.match(text, /--- PROJECTS ---\nR&D tool\n- Handles A & B\./);
});

test('a tab after ### keeps each project with its own bullets', () => {
  const parsed = parseCvMarkdown(`## Projects

###\tAlpha

- One.

###\tBeta

- Two.
`);
  assert.equal(parsed.projects.length, 2);
  assert.equal(parsed.projects[0].name, 'Alpha');
  assert.deepEqual(parsed.projects[0].bullets, ['One.']);
  assert.equal(parsed.projects[1].name, 'Beta');
  assert.deepEqual(parsed.projects[1].bullets, ['Two.']);
});
