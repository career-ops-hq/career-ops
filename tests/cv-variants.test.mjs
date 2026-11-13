// Opt-in CV content variants (#6792): data/cv-variants/<name>.md reorder,
// condense or omit what cv.md says, and never add a claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVariant, checkVariant, auditCvVariants } from '../lib/cv-variants.mjs';

const CV = `# Jane Doe

## Work Experience

### Acme Corp -- Sydney

**Senior Engineer**
2020-2024

- Cut deploy time from 2 weeks to 4 hours with GitHub Actions
- Led a team of 3 engineers

### Beta Ltd -- Remote

**Engineer**
2018-2020

- Built an NLP pipeline with 94% accuracy
`;

function workspace(variants = {}) {
  const root = mkdtempSync(join(tmpdir(), 'co-variants-'));
  writeFileSync(join(root, 'cv.md'), CV);
  mkdirSync(join(root, 'data', 'cv-variants'), { recursive: true });
  for (const [file, text] of Object.entries(variants)) writeFileSync(join(root, 'data', 'cv-variants', file), text);
  return root;
}

const OMIT_AND_REORDER = `# Jane Doe

## Work Experience

### Beta Ltd -- Remote

**Engineer**
2018-2020

- Built an NLP pipeline with 94% accuracy

### Acme Corp -- Sydney

**Senior Engineer**
2020-2024

- Led a team of 3 engineers
`;

test('no variant named resolves to cv.md', () => {
  const root = workspace();
  assert.equal(resolveVariant(undefined, { root }), join(root, 'cv.md'));
});

test('a named variant resolves to its file, name normalised', () => {
  const root = workspace({ 'data-science.md': OMIT_AND_REORDER });
  assert.equal(resolveVariant('Data Science', { root }), join(root, 'data', 'cv-variants', 'data-science.md'));
});

test('a missing variant throws and does not fall back to cv.md', () => {
  assert.throws(() => resolveVariant('nope', { root: workspace() }), /nope/);
});

test('a variant that does not parse throws', () => {
  const root = workspace({ 'empty.md': '# Jane\n\nNothing here.\n' });
  assert.throws(() => resolveVariant('empty', { root }), /parse/);
});

test('reordering and omitting cv.md content is clean', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER });
  assert.deepEqual(checkVariant('a', { root }).problems, []);
});

test('an added claim is a facts problem', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER.replace('Led a team of 3 engineers', 'Led a team of 30 engineers and grew revenue 250%') });
  const types = checkVariant('a', { root }).problems.map((p) => p.type);
  assert.ok(types.includes('facts'), JSON.stringify(types));
});

test('an inflated title is a title problem', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER.replace('**Senior Engineer**', '**VP of Engineering**') });
  const problems = checkVariant('a', { root }).problems;
  const title = problems.find((p) => p.type === 'title');
  assert.ok(title, JSON.stringify(problems));
  assert.match(title.detail, /VP of Engineering/);
});

test('audit reports only variants with problems, and [] with none', () => {
  assert.deepEqual(auditCvVariants({ root: workspace() }), []);
  const root = workspace({ 'good.md': OMIT_AND_REORDER, 'bad.md': '# Jane\n' });
  const findings = auditCvVariants({ root });
  assert.deepEqual(findings.map((f) => f.name), ['bad']);
  assert.equal(findings[0].problems[0].type, 'parse');
});

test('a file name --variant cannot select is a name problem, and the audit still runs', () => {
  const root = workspace({ 'Back End.md': OMIT_AND_REORDER, 'bad.md': '# Jane\n' });
  const findings = auditCvVariants({ root });
  assert.deepEqual(findings.map((f) => f.problems[0].type), ['name', 'parse']);
  assert.match(findings[0].problems[0].detail, /back-end\.md/);
});

test('a job cv.md does not have is an added problem', () => {
  const root = workspace({ 'a.md': `${OMIT_AND_REORDER}
### Gamma Inc -- Perth

**Director**
2024-2025

- Ran a 40 person org
` });
  const added = checkVariant('a', { root }).problems.filter((p) => p.type === 'added');
  assert.equal(added.length, 1, JSON.stringify(added));
  assert.match(added[0].detail, /Gamma Inc/);
});

test('a date range rewritten from cv.md is an added problem', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER.replace('2018-2020', '2017-2020') });
  const added = checkVariant('a', { root }).problems.filter((p) => p.type === 'added');
  assert.equal(added.length, 1, JSON.stringify(added));
  assert.match(added[0].detail, /2017-2020/);
});

test('a condensed variant (fewer bullets, one job) is clean', () => {
  const root = workspace({ 'a.md': '## Work Experience\n\n### Acme Corp -- Sydney\n\n**Senior Engineer**\n2020-2024\n\n- Led a team of 3 engineers\n' });
  assert.deepEqual(checkVariant('a', { root }).problems, []);
});
