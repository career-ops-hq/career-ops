// Opt-in CV content variants (#6792): data/cv-variants/<name>.md reorder,
// condense or omit what cv.md says, and never add a claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVariant, checkVariant, auditCvVariants, variantForArchetype } from '../lib/cv-variants.mjs';

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
  mkdirSync(join(root, 'config'), { recursive: true });
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

test('config allowances do not support a variant claim (#6792)', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER.replace('Led a team of 3 engineers', 'Led a team of 3 engineers and cut costs 40%') });
  writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({ allow_metrics: ['40%'] }));
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

const PARTIAL = `## Work Experience

### Acme Corp -- Sydney

**Senior Engineer**
2020-2024

- Led a team of 3 engineers

### Beta Ltd -- Remote

Engineer, 2018-2020

- Built an NLP pipeline with 94% accuracy
`;

test('a variant with one present job that does not parse is rejected, not trusted', () => {
  const root = workspace({ 'p.md': PARTIAL });
  assert.throws(() => resolveVariant('p', { root }), /Beta Ltd/);
  const parse = checkVariant('p', { root }).problems.find((p) => p.type === 'parse');
  assert.ok(parse, 'expected a parse problem');
  assert.match(parse.detail, /Beta Ltd/);
});

test('an ambiguous title comparison (duplicate company and dates) is a problem with both titles', () => {
  const dup = `${OMIT_AND_REORDER}
### Acme Corp -- Sydney

**Staff Engineer**
2020-2024

- Led a team of 3 engineers
`;
  const root = workspace({ 'a.md': dup });
  const amb = checkVariant('a', { root }).problems.find((p) => p.type === 'ambiguous');
  assert.ok(amb, 'expected an ambiguous problem');
  assert.match(amb.detail, /Senior Engineer/);
  assert.match(amb.detail, /Staff Engineer/);
});

test('a fact-check coverage gap is a non-blocking facts problem', () => {
  const es = `## Experiencia

### Acme Corp -- Sydney

**Senior Engineer**
2020-2024

- Dirigi un equipo de ingenieros en la nube y mejore los procesos de entrega continua
`;
  const root = workspace({ 'a.md': es });
  const problems = checkVariant('a', { root }).problems;
  const cov = problems.find((p) => p.type === 'facts' && /could not cover/.test(p.detail));
  assert.ok(cov, JSON.stringify(problems));
});

test('a warn_phrases hit surfaces as a non-blocking advisory problem (#6792)', () => {
  const root = workspace({ 'a.md': OMIT_AND_REORDER });
  writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({ warn_phrases: ['NLP'] }));
  const types = checkVariant('a', { root }).problems.map((p) => p.type);
  assert.deepEqual(types, ['advisory']);
});

const BULLET_AS_DATES = `# Jane Doe

## Work Experience

### Acme Corp -- Sydney

**CTO**
- Led a team of 3 engineers
`;

test('a job whose line after the title is a bullet, not dates, is rejected (#6792)', () => {
  const root = workspace({ 'bad.md': BULLET_AS_DATES });
  assert.throws(() => resolveVariant('bad', { root }), /could not be parsed/);
  assert.equal(checkVariant('bad', { root }).problems[0].type, 'parse');
});

test('a job whose line after the title is prose, not dates, is rejected (#6792)', () => {
  const root = workspace({ 'bad.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', 'Built a pipeline') });
  assert.throws(() => resolveVariant('bad', { root }), /could not be parsed/);
});

test('a `1)` ordered list item where the dates should be is rejected (#6792)', () => {
  const root = workspace({ 'bad.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', '1) Led a team of 3 engineers') });
  assert.throws(() => resolveVariant('bad', { root }), /could not be parsed/);
});

test('one unreadable variant is a read problem and the audit still checks the rest (#6792)', () => {
  const root = workspace({ 'bad.md': '# Jane\n' });
  mkdirSync(join(root, 'data', 'cv-variants', 'a.md'));
  const findings = auditCvVariants({ root });
  assert.deepEqual(findings.map((f) => [f.name, f.problems[0].type]), [['a', 'read'], ['bad', 'parse']]);
});

test('numeric prose where the dates should be is rejected, real date shapes are kept (#6792)', () => {
  const root = workspace({ 'bad.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', 'Built 3 pipelines') });
  assert.throws(() => resolveVariant('bad', { root }), /could not be parsed/);
  for (const prose of ['Presented quarterly results', 'Currently hiring']) {
    const r = workspace({ 'bad.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', prose) });
    assert.throws(() => resolveVariant('bad', { root: r }), /could not be parsed/, prose);
  }
  for (const dates of ["Jan '21 - Dec '23", 'Jan ’21 – Present', '2020-2024', '2019 – 2024', 'Mar 2021 - Present', '03/21 - 05/23', '2021年3月 - 至今', '**2020 -- 2024**', 'Current']) {
    const ok = workspace({ 'ok.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', `${dates}\n\n- Led a team of 3 engineers`) });
    assert.doesNotThrow(() => resolveVariant('ok', { root: ok }), dates);
  }
});

test('a bullet moved under another employer is an attribution problem (#6792)', () => {
  const moved = OMIT_AND_REORDER.replace('- Led a team of 3 engineers', '- Led a team of 3 engineers\n- Built an NLP pipeline with 94% accuracy');
  const root = workspace({ 'a.md': moved });
  const problems = checkVariant('a', { root }).problems;
  const attr = problems.find((p) => p.type === 'attribution');
  assert.ok(attr, JSON.stringify(problems));
  assert.match(attr.detail, /Acme Corp/);
  assert.match(attr.detail, /Beta Ltd/);
});

test('a condensed variant with its own bullets has no attribution problem (#6792)', () => {
  const condensed = OMIT_AND_REORDER.replace('- Led a team of 3 engineers', '- Cut deploy time from 2 weeks to 4 hours with GitHub Actions');
  const root = workspace({ 'a.md': condensed });
  assert.deepEqual(checkVariant('a', { root }).problems.filter((p) => p.type === 'attribution'), []);
});

// Archetype mapping (#6792): cv.variants in config/profile.yml.
const withMap = (yaml, variants = { 'backend.md': OMIT_AND_REORDER }) => {
  const root = workspace(variants);
  writeFileSync(join(root, 'config', 'profile.yml'), yaml);
  return root;
};

test('a mapped archetype selects its variant, case and spacing normalised', () => {
  const root = withMap('cv:\n  variants:\n    backend: ["Backend Engineer", "Platform Engineer"]\n');
  assert.equal(variantForArchetype('  backend   ENGINEER ', { root }), 'backend');
});

test('an unmapped archetype, no cv.variants and no profile all select nothing', () => {
  assert.equal(variantForArchetype('Data Analyst', { root: withMap('cv:\n  variants:\n    backend: ["Backend Engineer"]\n') }), null);
  assert.equal(variantForArchetype('Backend Engineer', { root: withMap('cv:\n  template: modern\n') }), null);
  assert.equal(variantForArchetype('Backend Engineer', { root: workspace() }), null);
  assert.equal(variantForArchetype('', { root: workspace() }), null);
});

test('an archetype mapped by two variants throws naming both', () => {
  const root = withMap('cv:\n  variants:\n    a: ["Backend Engineer"]\n    b: ["backend engineer"]\n');
  assert.throws(() => variantForArchetype('Backend Engineer', { root }), /a.*b|b.*a/);
});

test('a non-list entry is ignored by the resolver and does not hide a valid mapping', () => {
  const root = withMap('cv:\n  variants:\n    a: "Backend Engineer"\n    b: ["Other"]\n');
  assert.equal(variantForArchetype('Backend Engineer', { root }), null);
  assert.equal(variantForArchetype('Other', { root }), 'b');
});

test('a mapped variant that is missing or unparseable stops through resolveVariant', () => {
  const root = withMap('cv:\n  variants:\n    ghost: ["Ghost"]\n    bad: ["Bad"]\n', { 'bad.md': '# Jane\n' });
  assert.throws(() => resolveVariant(variantForArchetype('Ghost', { root }), { root }), /ghost/);
  assert.throws(() => resolveVariant(variantForArchetype('Bad', { root }), { root }), /parse/);
});

test('auditCvVariants flags a mapping to a missing file, an invalid entry and a duplicate', () => {
  const root = withMap('cv:\n  variants:\n    ghost: ["Ghost"]\n    bad: "x"\n    a: ["Same"]\n    backend: ["same"]\n');
  const found = auditCvVariants({ root });
  const types = found.flatMap((f) => f.problems.map((p) => p.type));
  for (const t of ['map-missing', 'map-invalid', 'map-duplicate']) assert.ok(types.includes(t), JSON.stringify(found));
});

test('a healthy mapping adds no audit finding', () => {
  const root = withMap('cv:\n  variants:\n    backend: ["Backend Engineer"]\n');
  assert.deepEqual(auditCvVariants({ root }), []);
});

test('an equivalent date spelling still pairs the entry for attribution (#6792)', () => {
  const moved = OMIT_AND_REORDER.replace('2020-2024', '2020 – 2024').replace('- Led a team of 3 engineers', '- Led a team of 3 engineers\n- Built an NLP pipeline with 94% accuracy');
  const root = workspace({ 'a.md': moved });
  assert.ok(checkVariant('a', { root }).problems.some((p) => p.type === 'attribution'));
});

test('a default-root call reads the profile CAREER_OPS_PROFILE names', () => {
  const root = workspace({ 'backend.md': OMIT_AND_REORDER });
  const alt = join(root, 'alt-profile.yml');
  writeFileSync(alt, 'cv:\n  variants:\n    backend: ["Backend Engineer"]\n');
  const prev = { r: process.env.CAREER_OPS_ROOT, p: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_PROFILE = alt;
  try {
    assert.equal(variantForArchetype('Backend Engineer'), 'backend');
  } finally {
    for (const [k, v] of [['CAREER_OPS_ROOT', prev.r], ['CAREER_OPS_PROFILE', prev.p]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test('a moved bullet is found whatever its wrapping (#6792)', () => {
  const cv = CV.replace('- Built an NLP pipeline with 94% accuracy', '- Built an NLP pipeline\n  with 94% accuracy');
  const moved = OMIT_AND_REORDER.replace('- Led a team of 3 engineers', '- Led a team of 3 engineers\n- Built an NLP pipeline with\n  94% accuracy');
  const root = workspace({ 'a.md': moved });
  writeFileSync(join(root, 'cv.md'), cv);
  assert.ok(checkVariant('a', { root }).problems.some((p) => p.type === 'attribution'));
});

test('an unindented continuation line is part of its bullet (#6792)', () => {
  const cv = CV.replace('- Built an NLP pipeline with 94% accuracy', '- Built an NLP pipeline\nwith 94% accuracy');
  const moved = OMIT_AND_REORDER.replace('- Led a team of 3 engineers', '- Led a team of 3 engineers\n- Built an NLP pipeline with 94% accuracy');
  const root = workspace({ 'a.md': moved });
  writeFileSync(join(root, 'cv.md'), cv);
  assert.ok(checkVariant('a', { root }).problems.some((p) => p.type === 'attribution'));
});

test('a numbered achievement moved under another employer is an attribution problem (#6792)', () => {
  const cv = CV.replace('- Built an NLP pipeline with 94% accuracy', '1. Built an NLP pipeline with 94% accuracy');
  const moved = OMIT_AND_REORDER.replace('- Led a team of 3 engineers', '- Led a team of 3 engineers\n2) Built an NLP pipeline with 94% accuracy');
  const root = workspace({ 'a.md': moved });
  writeFileSync(join(root, 'cv.md'), cv);
  assert.ok(checkVariant('a', { root }).problems.some((p) => p.type === 'attribution'));
});

test('prose with a year where the dates should be is rejected (#6792)', () => {
  for (const prose of ['Built a pipeline in 2021', 'Led the 2020 migration']) {
    const root = workspace({ 'bad.md': BULLET_AS_DATES.replace('- Led a team of 3 engineers', prose) });
    assert.throws(() => resolveVariant('bad', { root }), /could not be parsed/, prose);
  }
});

test('a dates line cv.md itself uses is accepted, in any language (#6792)', () => {
  const cv = CV.replace('2018-2020', 'Enero 2018 - Actualidad');
  const variant = OMIT_AND_REORDER.replace('2018-2020', 'Enero 2018 - Actualidad');
  const root = workspace({ 'es.md': variant });
  writeFileSync(join(root, 'cv.md'), cv);
  assert.doesNotThrow(() => resolveVariant('es', { root }));
  assert.deepEqual(checkVariant('es', { root }).problems.filter((p) => p.type === 'parse'), []);
});
