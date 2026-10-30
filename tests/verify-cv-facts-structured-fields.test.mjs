// tests/verify-cv-facts-structured-fields.test.mjs — the employer, degree and
// certification a CV builder emits as structure are claims (#5348).
//
// factClaims() reads an employer only after a prose trigger ("worked at",
// "joined", "Company:"). A built CV never phrases one that way: the employer is
// a `job-company` span, the degree an `edu-title` div, and in LaTeX the first
// argument of \resumeSubheading. A payload that swapped the employer to Google,
// the degree to a PhD from MIT and added a certification rendered and got
// "CV fact check passed".
//
// The fixtures are built with the real builders, so a change to their markup
// that the gate stops reading fails here rather than in a user's CV.
//
// Run:  node --test tests/verify-cv-facts-structured-fields.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { structuredFieldClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-structured-facts-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const CV = `# Jane Doe

## Experience

### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024

- Led a team of 4 engineers.

## Education
BS Computer Science, State University

## Certifications
AWS Certified Developer – Associate
`;
const source = join(tmp, 'cv.md');
writeFileSync(source, CV);
const options = (extra = {}) => ({ sourcePaths: [source], configPath: join(tmp, 'none.json'), ...extra });

function build(script, payload, ext) {
  const input = join(tmp, `${script}-${Math.random().toString(36).slice(2)}.json`);
  const output = `${input}.${ext}`;
  writeFileSync(input, JSON.stringify(payload));
  const run = spawnSync(process.execPath, [join(ROOT, script), input, output], { encoding: 'utf-8' });
  assert.equal(run.status, 0, describeSpawn(run, `${script} failed`));
  return readFileSync(output, 'utf-8');
}

const htmlPayload = ({ company, role, degree, org, certs }) => ({
  candidate: { name: 'Jane Doe' },
  summary: 'Engineer.',
  experience: [{ company, role, dates: '2019 – 2024', bullets: ['Led a team of 4 engineers.'] }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
  education: [{ title: degree, org }],
  certifications: certs.map(title => ({ title })),
});

const texPayload = ({ company, role, degree, org }) => ({
  name: 'Jane Doe',
  contact_line: 'Remote',
  email: { url: 'jane@example.com', display: 'jane@example.com' },
  education: [{ institution: org, location: 'Boston', degree, dates: '2015 - 2019' }],
  experience: [{ company, role, location: 'Remote', dates: '2019 - 2024', bullets: ['Led a team of 4 engineers.'] }],
  projects: [{ name: 'Tooling', tech: 'Python', dates: '2023', bullets: ['Built internal tools.'] }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
});

const TRUE = {
  company: 'Acme Corp', role: 'Senior Software Engineer', degree: 'BS Computer Science',
  org: 'State University', certs: ['AWS Certified Developer – Associate'],
};

const kinds = (facts) => facts.map(({ kind, value }) => `${kind}=${value}`).sort();

test('a truthful built HTML CV passes', () => {
  const result = verifyFacts(build('build-cv-html.mjs', htmlPayload(TRUE), 'html'), options());
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

test('a swapped employer, degree, institution and certification in built HTML block', () => {
  const html = build('build-cv-html.mjs', htmlPayload({
    ...TRUE, company: 'Google', degree: 'PhD Computer Science', org: 'MIT', certs: ['CKA'],
  }), 'html');
  const result = verifyFacts(html, options());
  assert.equal(result.verdict, 'block');
  assert.deepEqual(kinds(result.unsupportedFacts), [
    'certification=cka', 'education=mit', 'education=phd computer science', 'employer=google',
  ]);
});

test('an unsourced job title in built HTML warns and does not block', () => {
  const html = build('build-cv-html.mjs', htmlPayload({ ...TRUE, role: 'Principal Engineer' }), 'html');
  const result = verifyFacts(html, options());
  assert.equal(result.verdict, 'warn', 'titles warn, as cv-title-check.mjs does');
  assert.deepEqual(kinds(result.advisoryFacts), ['title=principal engineer']);
  assert.deepEqual(result.unsupportedFacts, []);
});

test('allow_facts accepts a verified structured field', () => {
  const config = join(tmp, 'allow.json');
  writeFileSync(config, JSON.stringify({ allow_facts: ['Google'] }));
  const html = build('build-cv-html.mjs', htmlPayload({ ...TRUE, company: 'Google' }), 'html');
  assert.equal(verifyFacts(html, options({ configPath: config })).verdict, 'pass');
});

test('the organization slot of a built LaTeX CV blocks, the title slot warns', () => {
  assert.equal(verifyFacts(build('build-cv-latex.mjs', texPayload(TRUE), 'tex'), options()).verdict, 'pass');

  const swapped = verifyFacts(build('build-cv-latex.mjs', texPayload({ ...TRUE, company: 'Google', org: 'MIT' }), 'tex'), options());
  assert.equal(swapped.verdict, 'block');
  assert.deepEqual(kinds(swapped.unsupportedFacts), ['organization=google', 'organization=mit']);

  const retitled = verifyFacts(build('build-cv-latex.mjs', texPayload({ ...TRUE, role: 'Principal Engineer' }), 'tex'), options());
  assert.equal(retitled.verdict, 'warn');
  assert.deepEqual(kinds(retitled.advisoryFacts), ['title=principal engineer']);
});

test('a LaTeX escape inside a field is read as the character', () => {
  const claims = structuredFieldClaims(String.raw`\begin{document}
    \resumeSubheading
      {AT\&T Labs}{2019 - 2024}
      {R\&D Engineer}{Remote}
  \end{document}`);
  assert.deepEqual(kinds(claims), ['organization=at&t labs', 'title=r&d engineer']);
});

test('the \\resumeSubheading definition in a preamble is not a claim', () => {
  const tex = String.raw`\documentclass{article}
\newcommand{\resumeSubheading}[4]{\item #1 #2 #3 #4}
\begin{document}
\end{document}`;
  assert.deepEqual(structuredFieldClaims(tex), []);
});

test('skills lists are not structured claims', () => {
  const html = build('build-cv-html.mjs', {
    ...htmlPayload(TRUE),
    skills: [{ category: 'Platforms', items: 'Kubernetes, Terraform' }],
  }, 'html');
  assert.equal(verifyFacts(html, options()).verdict, 'pass', 'rewording a skill is the tailoring the gate allows');
});

test('a nowrap span inside a title keeps its hyphenated word (#5632)', () => {
  // generate-pdf wraps hyphenated words in an unclassed nowrap span before the
  // gate runs; reading that span as a nested field dropped "Full-Stack".
  const claims = structuredFieldClaims(
    '<div class="job-role">Senior <span style="white-space:nowrap">Full-Stack</span> Engineer</div>');
  assert.deepEqual(kinds(claims), ['title=senior full-stack engineer']);
});

test('a nowrap span inside an edu-title keeps its word and separates edu-org (#5632)', () => {
  const claims = structuredFieldClaims(
    '<div class="edu-title">M.Sc. <span style="white-space:nowrap">Human-Computer</span> Interaction <span class="edu-org">State University</span></div>');
  assert.deepEqual(kinds(claims), [
    'education=m.sc. human-computer interaction',
    'education=state university',
  ]);
});

test('a span structured field containing a nowrap span does not close early (#5632)', () => {
  const claims = structuredFieldClaims(
    '<span class="job-company">The <span style="white-space:nowrap">Coca-Cola</span> Company</span>');
  assert.deepEqual(kinds(claims), ['employer=the coca-cola company']);
});

test('nested edu-org with inner nowrap span is completely removed from edu-title (#5632)', () => {
  const claims = structuredFieldClaims(
    '<div class="edu-title">M.Sc. <span style="white-space:nowrap">Human-Computer</span> Interaction <span class="edu-org">The <span style="white-space:nowrap">State-University</span> of New York</span></div>');
  assert.deepEqual(kinds(claims), [
    'education=m.sc. human-computer interaction',
    'education=the state-university of new york',
  ]);
});


