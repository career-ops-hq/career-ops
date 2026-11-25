import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { extractJdSkills } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);

test('a requirements list on the header line is extracted', () => {
  const jd = [
    'Globex Analytics - Senior Data Analyst',
    'Requirements: 4+ years in analytics; strong SQL; dbt; Tableau or Looker; Python (pandas).',
    'Nice to have: healthcare data, Airflow, stakeholder management.',
  ].join('\n');
  assert.deepEqual(extractJdSkills(jd).sort(), ['Airflow', 'Looker', 'Python', 'SQL', 'Tableau']);
});

test('a sentence after a requirements-style header is not read as a list', () => {
  assert.deepEqual(extractJdSkills('About you: Curious about Kubernetes.\n'), []);
});

test('bullets under a plain header still extract the same', () => {
  assert.deepEqual(extractJdSkills('Requirements:\n- Strong Python\n- Terraform\n').sort(), ['Python', 'Terraform']);
});
