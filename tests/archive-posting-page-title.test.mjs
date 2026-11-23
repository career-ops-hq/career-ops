// parsePageTitle names a capture's company and role from the page title. The
// company is one end of the title, never a middle piece: a role with its own
// separator ("… Manager - Dutch Speaking - Teamtailor") used to file its
// capture under "Dutch Speaking - Teamtailor".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CAREER_OPS_ROOT = mkdtempSync(join(tmpdir(), 'career-ops-page-title-'));
const { parsePageTitle } = await import('../archive-posting.mjs?page-title');

const cases = [
  // The live Teamtailor title that produced the "dutch-speaking---teamtailor" capture.
  ['Customer Success Manager - Dutch Speaking - Teamtailor', 'Teamtailor', 'Customer Success Manager - Dutch Speaking'],
  ['Software Engineer - Backend - Acme', 'Acme', 'Software Engineer - Backend'],
  ['Engineer | Platform | Acme', 'Acme', 'Engineer | Platform'],
  ['Senior Engineer - Backend | Acme', 'Acme', 'Senior Engineer - Backend'],
  // Lever titles lead with the company.
  ['Acme - Senior Engineer', 'Acme', 'Senior Engineer'],
  // Shapes the parser already handled keep their result.
  ['Senior AI Engineer at Anthropic', 'Anthropic', 'Senior AI Engineer'],
  ['Anthropic | Senior AI Engineer', 'Anthropic', 'Senior AI Engineer'],
  ['Senior AI Engineer - Anthropic', 'Anthropic', 'Senior AI Engineer'],
  ['Senior AI Engineer – Anthropic', 'Anthropic', 'Senior AI Engineer'],
  ['Platform Engineer | Recruiting Partner', 'Recruiting Partner', 'Platform Engineer'],
  ['CNC Operator - Acme', 'Acme', 'CNC Operator'],
  ['Senior AI Engineer - Anthropic - Greenhouse', 'Anthropic', 'Senior AI Engineer'],
  ['Senior AI Engineer — Anthropic — Greenhouse', 'Anthropic', 'Senior AI Engineer'],
  // A role keyword inside a company name is not a role: "Headway" contains "head".
  ['Customer Success - Headway', 'Headway', 'Customer Success'],
  ['Headway | Operations', 'Headway', 'Operations'],
  // "Engineering" is a role word too, so the whole-word rule keeps these right.
  ['Data Engineering | Acme', 'Acme', 'Data Engineering'],
  ['Software Engineering Intern | Stripe', 'Stripe', 'Software Engineering Intern'],
];

test('an em-dash ATS suffix is stripped, not taken as the company', () => {
  assert.deepEqual(parsePageTitle('Engineer — Greenhouse'), { company: null, role: 'Engineer' });
});

for (const [title, company, role] of cases) {
  test(`"${title}" → company "${company}", role "${role}"`, () => {
    assert.deepEqual(parsePageTitle(title), { company, role });
  });
}

test('a hyphen inside a word is not a separator', () => {
  assert.deepEqual(parsePageTitle('Co-Founder - Acme'), { company: 'Acme', role: 'Co-Founder' });
});

test('a title with no separator is all role, and no title is nothing', () => {
  assert.deepEqual(parsePageTitle('Careers'), { company: null, role: 'Careers' });
  assert.deepEqual(parsePageTitle(''), { company: null, role: null });
});
