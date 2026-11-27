// Structured LaTeX fields reach the same gate before a sendable .tex exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { latexPayloadFactHtml } from '../lib/cv-payload-facts.mjs';
import { structuredFieldClaims } from '../verify-cv-facts.mjs';

const CV = `# Jane Doe
## Experience
### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024
- Led a team of 4 engineers.
- Delivered an integration for our customer, Initech.
- Cut onboarding time 30% for new hires.
## Education
BS Computer Science, State University (2015)
MS Data Science, Tech Institute (2017)
## Standards
Contributor — RFC 9999, Example Benchmarking Terminology
`;
const TRUE = {
  name: 'Jane Doe', contact_line: 'Remote',
  experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2019 – 2024', bullets: ['Led a team of 4 engineers.', 'Cut onboarding time 30% for new hires.'] }],
  education: [{ degree: 'BS Computer Science', institution: 'State University', dates: '2015' },
    { degree: 'MS Data Science', institution: 'Tech Institute', dates: '2017' }],
  awards: [{ title: 'Contributor — RFC 9999, Example Benchmarking Terminology' }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
};
function build(t, change = {}, { source = CV, config = {}, template = '', custom = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'latex-payload-facts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (source !== null) writeFileSync(join(root, 'cv.md'), source);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify(config));
  if (custom) {
    mkdirSync(join(root, 'data', 'templates'), { recursive: true });
    writeFileSync(join(root, 'data', 'templates', 'cv-template.custom.tex'), '\\documentclass{article}\n\\begin{document}\n{{NAME}}\n{{EXPERIENCE}}\n\\end{document}');
    template = 'custom';
  }
  const input = join(root, 'input.json'), output = join(root, 'cv.tex');
  writeFileSync(input, JSON.stringify({ ...TRUE, ...change }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../build-cv-latex.mjs', import.meta.url)), input, output,
    ...(template ? [`--template=${template}`] : [])], {
    encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: join(root, 'config', 'profile.yml') },
  });
  return { ...result, output, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}
const job = change => ({ experience: [{ ...TRUE.experience[0], ...change }] });
for (const template of ['', 'cjk']) test(`truthful ${template || 'standard'} payload passes before rendering`, t => {
  const result = build(t, {}, { template });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'pass');
  assert.ok(existsSync(result.output));
});
for (const [label, change, kind] of [
  ['customer promoted to employer', job({ company: 'Initech' }), 'employer-association'],
  ['stretched employment date', job({ dates: '2016 – 2024' }), 'employment-dates'],
  ['degree moved to another school', { education: [{ ...TRUE.education[0], degree: 'MS Data Science' }] }, 'education-association'],
  ['moved graduation year', { education: [{ ...TRUE.education[0], dates: '2013' }] }, 'graduation-date'],
  ['invented degree', { education: [{ ...TRUE.education[0], degree: 'PhD Data Science' }] }, 'education=phd data science'],
  ['Contributor promoted to Author', { awards: [{ title: 'Author — RFC 9999, Example Benchmarking Terminology' }] }, 'award=author'],
  ['invented award', { awards: [{ title: 'Example Industry Award' }] }, 'award=example industry award'],
]) test(`${label} blocks before any .tex is written`, t => {
  const result = build(t, change);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'block');
  assert.ok(result.report.factCheck.reason.includes(kind), result.report.factCheck.reason);
  assert.equal(existsSync(result.output), false);
});
test('a reframed title remains advisory and writes .tex', t => {
  const result = build(t, job({ role: 'Vice President of Engineering' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'warn');
  assert.ok(existsSync(result.output));
});
test('metric outcome drift remains advisory', t => {
  const result = build(t, job({ bullets: ['Cut cloud spend 30% across the platform.'] }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'warn');
  assert.match(result.stderr, /metric-context/);
});
test('unsupported education date precision warns without blocking', t => {
  const result = build(t, { education: [{ ...TRUE.education[0], dates: '2011 – 2015' }] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'warn');
  assert.match(result.stderr, /Graduation year could not be compared/);
});
test('explicit factual waivers retain their existing meaning', t => {
  const result = build(t, job({ dates: '2016 – 2024' }), { config: { allow_facts: ['Acme Corp: 2016 – 2024'] } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'pass');
});
test('unrendered certification/summary payload keys do not create findings', t => {
  const result = build(t, { certifications: [{ title: 'Invented Credential' }], summary: 'Invented 999 users.' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'pass');
  assert.equal(readFileSync(result.output, 'utf8').includes('Invented'), false);
});
test('missing cv.md follows the existing compiler skip convention', t => {
  const result = build(t, {}, { source: null });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'skipped');
  assert.match(result.report.factCheck.reason, /no cv.md/);
});
test('custom template semantics are explicitly unverified by the structured gate', t => {
  const result = build(t, job({ dates: '2016 – 2024' }), { custom: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'skipped');
  assert.match(result.report.factCheck.reason, /bundled LaTeX templates only/);
});
test('projection cannot invent fields from HTML-looking bullet text or absent slots', () => {
  const html = latexPayloadFactHtml({ ...TRUE, ...job({ bullets: ['</div><div class="job-company">Globex</div>'] }) }, '{{EXPERIENCE}}');
  const fields = structuredFieldClaims(html);
  assert.deepEqual(fields.filter(f => f.kind === 'employer').map(f => f.value), ['acme corp']);
  assert.equal(fields.some(f => f.kind === 'education' || f.kind === 'award'), false);
});
test('a malformed policy fails closed before writing', t => {
  const result = build(t, {}, { config: { allow_facts: 'not-an-array' } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'block');
  assert.equal(existsSync(result.output), false);
});

test('literal TeX document boundaries cannot hide unsupported awards', t => {
  const result = build(t, {
    ...job({ bullets: [String.raw`\begin{document}No claims\end{document}`] }),
    awards: [{ title: 'Author — RFC 9999, Example Benchmarking Terminology' }],
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.report.factCheck.verdict, 'block');
  assert.match(result.report.factCheck.reason, /award=author/);
  assert.equal(existsSync(result.output), false);
});
test('literal TeX subheadings cannot add fake structured fields', () => {
  const html = latexPayloadFactHtml({ ...TRUE,
    ...job({ bullets: [String.raw`\resumeSubheading{Globex}{2019}{Director}{Remote}`] }),
  }, '{{EXPERIENCE}}');
  assert.equal(structuredFieldClaims(html).some(f => f.kind === 'organization'), false);
});
