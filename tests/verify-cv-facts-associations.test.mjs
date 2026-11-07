import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyFacts, metricClaims } from '../verify-cv-facts.mjs';

// The fictional 15-row counterexample supplied on #1411, exercised through
// the real HTML builder. No model, personal data or policy defaults involved.
const CV = `# Jane Doe

## Experience

### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024

- Led a team of 4 engineers.
- Delivered the integration for our largest customer, Initech.
- Cut onboarding time 30% for new hires.

## Education
BS Computer Science, State University (2015)
MS Data Science, Tech Institute (2017)

## Certifications
AWS Certified Developer – Associate

## Standards
Contributor — RFC 9999, Example Benchmarking Terminology
`;

const TRUE = {
  company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2019 – 2024',
  bullets: ['Led a team of 4 engineers.', 'Cut onboarding time 30% for new hires.'],
  education: [{ title: 'BS Computer Science', org: 'State University', year: '2015' },
              { title: 'MS Data Science', org: 'Tech Institute', year: '2017' }],
  certs: ['AWS Certified Developer – Associate'],
  awards: [{ title: 'Contributor — RFC 9999, Example Benchmarking Terminology' }],
};
const payload = (p) => ({
  candidate: { name: 'Jane Doe' }, summary: 'Engineer.',
  experience: [{ company: p.company, role: p.role, dates: p.dates, bullets: p.bullets }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
  education: p.education, certifications: p.certs.map((title) => ({ title })), awards: p.awards,
});
const edu = (i, change) => TRUE.education.map((e, j) => (j === i ? { ...e, ...change } : e));

// [row, change]
const ROWS = [
  [1, { company: 'Globex' }],
  [2, { company: 'Initech' }],
  [3, { dates: '2016 – 2024' }],
  [4, { role: 'Vice President of Engineering' }],
  [5, { education: edu(1, { title: 'PhD Data Science' }) }],
  [6, { education: edu(0, { title: 'MS Data Science' }) }],
  [7, { education: edu(0, { year: '2013' }) }],
  [8, { education: edu(0, { org: 'Stanford University' }) }],
  [9, { certs: ['Certified Kubernetes Administrator'] }],
  [10, { awards: [{ title: 'Author — RFC 9999, Example Benchmarking Terminology' }] }],
  [11, { awards: [{ title: 'Author — RFC 9998, Example Benchmarking Methodology' }] }],
  [12, { awards: [{ title: 'Example Industry Award' }] }],
  [13, { bullets: ['Led a team of 4 engineers.', 'Cut cloud spend 30% across the platform.'] }],
  [14, { bullets: ['Led a team of 4 engineers.', 'Cut onboarding time 45% for new hires.'] }],
  [15, { bullets: ['Led a team of 4 engineers.', 'Ran an 8-week pilot on a 16-node cluster.',
                   'Cut onboarding time 30% for new hires.'] }],
];

const tmp = mkdtempSync(join(tmpdir(), 'cv-associations-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
function check(change = {}, sourceText = CV, config = {}) {
  const source = join(tmp, 'cv.md'), input = join(tmp, 'input.json'), output = join(tmp, 'cv.html');
  const configPath = join(tmp, 'policy.json');
  writeFileSync(source, sourceText);
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(input, JSON.stringify(payload({ ...TRUE, ...change })));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../build-cv-html.mjs', import.meta.url)), input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return verifyFacts(readFileSync(output, 'utf8'), { sourcePaths: [source], configPath });
}
const EXPECTED = {
  1: ['block', 'employer'], 2: ['block', 'employer-association'],
  3: ['block', 'employment-dates'], 4: ['warn', 'title'],
  5: ['block', 'education'], 6: ['block', 'education-association'],
  7: ['block', 'graduation-date'], 8: ['block', 'education'],
  9: ['block', 'certification'], 10: ['block', 'award'],
  11: ['block', 'award'], 12: ['block', 'award'],
  13: ['warn', 'metric-context'], 14: ['block', '45%'],
  15: ['block', '8 weeks'],
};
test('truthful control passes', () => assert.equal(check().verdict, 'pass'));
for (const [row, change] of ROWS) test(`counterexample row ${row}`, () => {
  const result = check(change);
  const [verdict, finding] = EXPECTED[row];
  assert.equal(result.verdict, verdict, JSON.stringify(result));
  assert.ok([...result.unsupportedFacts, ...result.advisoryFacts].some(f => f.kind === finding)
    || result.invented.includes(finding), JSON.stringify(result));
  if (row === 15) assert.ok(result.invented.includes('16 nodes'));
});
test('changing only the employment end year blocks', () => {
  assert.ok(check({ dates: '2019 – 2025' }).unsupportedFacts.some(f => f.kind === 'employment-dates'));
});
test('month-precise source supports the same year-only interval', () => {
  assert.equal(check({}, CV.replace('2019 – 2024', 'Jan 2019 – Dec 2024')).verdict, 'pass');
});
test('a changed employment month blocks when source months are explicit', () => {
  assert.ok(check({ dates: 'Feb 2019 – Dec 2024' }, CV.replace('2019 – 2024', 'Jan 2019 – Dec 2024'))
    .unsupportedFacts.some(f => f.kind === 'employment-dates'));
});
test('greater target date precision warns when source only has years', () => {
  const result = check({ dates: 'Jan 2019 – Dec 2024' });
  assert.equal(result.verdict, 'warn');
  assert.ok(result.coverage?.message.includes('precision'));
});
test('unrecognized education convention warns instead of fabricating a comparison', () => {
  const result = check({}, CV.replace('BS Computer Science, State University (2015)', 'State University: BS Computer Science (2015)')
    .replace('MS Data Science, Tech Institute (2017)', 'Tech Institute: MS Data Science (2017)'));
  assert.equal(result.verdict, 'warn');
  assert.ok(result.coverage?.message.includes('Education'));
});
test('an intentional date override uses the existing allow_facts contract', () => {
  assert.equal(check({ dates: '2016 – 2024' }, CV, { allow_facts: ['Acme Corp: 2016 – 2024'] }).verdict, 'pass');
});
test('a source-backed title transplanted from another employer warns', () => {
  const source = CV.replace('## Education', '### Globex — Remote\n**Principal Engineer**\n2010 – 2018\n\n## Education');
  const result = check({ role: 'Principal Engineer' }, source);
  assert.equal(result.verdict, 'warn');
  assert.ok(result.advisoryFacts.some(f => f.kind === 'title-association'));
});
test('a genuine second job at a customer is accepted as employment evidence', () => {
  const source = CV.replace('## Education', '### Initech — Remote\n**Senior Software Engineer**\n2019 – 2024\n- Led a team of 4 engineers.\n- Cut onboarding time 30% for new hires.\n\n## Education');
  assert.equal(check({ company: 'Initech' }, source).verdict, 'pass');
});
test('the same metric in another job does not silently support this role', () => {
  const source = CV.replace('- Cut onboarding time 30% for new hires.', '')
    .replace('## Education', '### Globex — Remote\n**Principal Engineer**\n2010 – 2018\n- Cut cloud spend 30% across the platform.\n\n## Education');
  const result = check({ bullets: ['Cut cloud spend 30% across the platform.'] }, source);
  assert.equal(result.verdict, 'warn');
  assert.ok(result.advisoryFacts.some(f => f.kind === 'metric-context'));
});
test('a declared metric waiver also waives its uncertain context', () => {
  assert.equal(check({ bullets: ['Cut cloud spend 30% across the platform.'] }, CV, { allow_metrics: ['30%'] }).verdict, 'pass');
});

test('a same-employer title from another period stays advisory', () => {
  const source = CV.replace('## Education', '### Acme Corp — Remote\n**Principal Engineer**\n2025 – Present\n\n## Education');
  const result = check({ role: 'Principal Engineer' }, source);
  assert.equal(result.verdict, 'warn');
  assert.ok(result.advisoryFacts.some(f => f.kind === 'title-association'));
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'employment-dates'), false);
});

test('compound counts retain the same plan-horizon rules as spaced counts', () => {
  assert.deepEqual([...metricClaims('In my first 8-week period, I will improve onboarding.')],
    [...metricClaims('In my first 8 weeks period, I will improve onboarding.')]);
  assert.deepEqual([...metricClaims('Used ISO-8-week profiles.')], []);
});

test('an incompletely formatted real employer is not treated as merely a customer', () => {
  const source = CV.replace('## Education', '### Initech — Remote\nSenior Software Engineer\n2019 – 2024\n\n## Education');
  const result = check({ company: 'Initech', bullets: [] }, source);
  assert.equal(result.verdict, 'warn');
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'employer-association'), false);
  assert.ok(result.coverage?.message.includes('Employment dates'));
});
test('mixed education conventions cannot establish a hard contradictory tuple', () => {
  const source = CV.replace('## Certifications', 'Tech Institute: BS Computer Science (2017)\n\n## Certifications');
  // The free-text line could explain the combination: the flat parser must
  // report the incomplete coverage rather than assert the pair is impossible.
  const result = check({ education: edu(0, { org: 'Tech Institute' }) }, source);
  assert.equal(result.verdict, 'warn');
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'education-association'), false);
});

test('comma-delimited education details cannot turn a truthful pair into a block', () => {
  const source = CV.replace('MS Data Science, Tech Institute (2017)',
    'MS Data Science, State University, GPA 4.0 (2017)');
  const result = check({ education: [{ title: 'MS Data Science', org: 'State University', year: '2017' }] }, source);
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(result.unsupportedFacts.some(f => f.kind === 'education-association'), false);
  assert.ok(result.coverage?.message.includes('Education'));
});
