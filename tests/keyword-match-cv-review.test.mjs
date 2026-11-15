import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as coverage from '../keyword-match.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const cv = '# Example\n\n## Summary\nRust specialist.\n\n## Core Competencies\nStrategic planning | Stakeholder engagement\n\n## Skills\n- **Languages:** Python, Java, C++\n- **Infrastructure:** k8s; Terraform; AWS\n\n## Experience\nBuilt Rust services.\n';

test('review list reads only the CV skills and competencies, preserving its terms', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Python', 'Kubernetes', 'Amazon Web Services'], cv),
    ['Strategic planning', 'Stakeholder engagement', 'Java', 'C++', 'Terraform']);
});

test('review matching shares coverage synonyms, plural forms and word boundaries', () => {
  const text = '## Skills\nJava, JS, k8s, LLMs, C++, CI/CD, strategic planning';
  assert.deepEqual(coverage.cvTermsNotInJd(['JavaScript', 'Kubernetes', 'large language models', 'C++', 'cicd', 'strategic planning'], text), ['Java']);
});

test('separate JD keywords cannot form a phrase across their boundary', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Strategic', 'planning'], '## Skills\nStrategic planning'), ['Strategic planning']);
});

test('duplicate CV terms are listed once, keeping the first spelling', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Python'], '## Skills\nTerraform, terraform\n- TERRAFORM\n## Core Competencies\nTerraform | Hiring'), ['Terraform', 'Hiring']);
});

test('Pandoc headings, nested skill headings and categories remain readable', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Python'], '## **[Technical Skills]{.smallcaps}**\r\n### Languages\r\n- **Programming:** Python, Rust\r\n## Education\r\nTerraform'), ['Rust']);
});

test('link destinations, comments and fenced examples are not CV skill terms', () => {
  const text = '## Skills\n[Python](https://example.invalid/terraform), Java\n<!-- Kubernetes -->\n```\nRust\n```\n## Experience\nAWS';
  assert.deepEqual(coverage.cvTermsNotInJd(['Python'], text), ['Java']);
});

test('HTML review reads visible skill sections, not styles, attributes or other sections', () => {
  const text = '<style>Terraform</style><h2>Summary</h2><p>Rust</p><h2>Skills</h2><ul><li><b>Languages:</b> Python, Java</li><li><a href="https://example.invalid/aws">k8s</a></li></ul><h2>Experience</h2><p>Terraform</p>';
  assert.deepEqual(coverage.cvTermsNotInJd(['Python', 'Kubernetes'], text, { html: true }), ['Java']);
});

test('no skills section or an empty one produces no guessed terms', () => {
  assert.deepEqual(coverage.cvTermsNotInJd([], 'Python and Rust in my career.'), []);
  assert.deepEqual(coverage.cvTermsNotInJd([], '## Skills\n\n## Education\nPython'), []);
});

test('Markdown review is informational, not a precision score or a coverage change', () => {
  const base = coverage.analyzeCoverage(['Python', 'Java'], 'Python');
  const rendered = coverage.formatCoverageMarkdown({ ...base, cvTermsNotInJd: ['Terraform'] });
  assert.match(rendered, /In your CV, not named in this JD \(review, keep the differentiators\)/);
  assert.match(rendered, /Terraform/);
  assert.match(rendered, /Informational only/);
  assert.match(rendered, /ATS coverage: 50%/);
  assert.deepEqual(coverage.analyzeCoverage(['Python', 'Java'], 'Python'), base);
  assert.doesNotMatch(rendered, /precision.*\d|remove Terraform|delete Terraform/i);
});

test('real report CLI adds the same review list to JSON and Markdown without changing coverage or files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyword-cv-review-'));
  try {
    const report = join(dir, 'report.md');
    const cvPath = join(dir, 'cv.md');
    writeFileSync(report, '# Example\n\n## Keywords extracted\n\n- Python\n- Kubernetes\n- Go\n');
    writeFileSync(cvPath, cv);
    const run = flags => spawnSync(process.execPath, [join(ROOT, 'keyword-match.mjs'), report, '--cv', cvPath, ...flags], {
      encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: dir }, timeout: 20000,
    });
    const json = run(['--json']);
    assert.equal(json.status, 0, json.stderr);
    const result = JSON.parse(json.stdout);
    assert.deepEqual(result.cvTermsNotInJd, ['Strategic planning', 'Stakeholder engagement', 'Java', 'C++', 'Terraform', 'AWS']);
    assert.deepEqual(result.present, ['Python', 'Kubernetes']);
    assert.deepEqual(result.missing, ['Go']);
    assert.equal(result.coveragePct, 67);
    const markdown = run([]);
    assert.equal(markdown.status, 0, markdown.stderr);
    assert.match(markdown.stdout, /review, keep the differentiators/);
    assert.match(markdown.stdout, /Strategic planning, Stakeholder engagement, Java, C\+\+, Terraform, AWS/);
    assert.equal(readFileSync(cvPath, 'utf8'), cv);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('review keeps separators within parenthesized skill qualifiers intact', () => {
  const text = '## Skills\n**Lab:** Measurement (oscilloscope, spectrum analyzer), BGA rework; Analysis (signals (FFT, DFT); noise) | Documentation';
  assert.deepEqual(coverage.cvTermsNotInJd(['BGA rework'], text), [
    'Measurement (oscilloscope, spectrum analyzer)', 'Analysis (signals (FFT, DFT); noise)', 'Documentation',
  ]);
});

test('fence-looking code with a text suffix cannot close an example block', () => {
  const text = '## Skills\n~~~text\n~~~still-code\nRust\n~~~\nTerraform';
  assert.deepEqual(coverage.cvTermsNotInJd([], text), ['Terraform']);
});

test('skills at any ATX or HTML heading level stop at peer and ancestor sections', () => {
  for (let level = 1; level <= 6; level++) {
    const hashes = '#'.repeat(level);
    assert.deepEqual(coverage.cvTermsNotInJd([], `${hashes} Skills\nTerraform\n${hashes} Education\nRust`), ['Terraform']);
    assert.deepEqual(coverage.cvTermsNotInJd([], `<h${level}>Skills</h${level}><p>Terraform</p><h${level}>Education</h${level}><p>Rust</p>`, { html: true }), ['Terraform']);
  }
  assert.deepEqual(coverage.cvTermsNotInJd([], '# Skills\n## Languages\nRust\n# Education\nTerraform'), ['Rust']);
});

test('inline formatting is visible text, not part of a CV skill name', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Python', 'Rust'], '## Skills\n`Python`, *Rust*, _Rust_, **Python**, C++, Node.js'), ['C++', 'Node.js']);
  assert.deepEqual(coverage.cvTermsNotInJd([], '## Skills\n`Python`, *Rust*, _Rust_, **Python**'), ['Python', 'Rust']);
});

test('HTML raw-text end tags with whitespace, attributes or a slash do not leak script/style contents', () => {
  for (const tag of ['script', 'style']) for (const ending of [`</${tag} ignored>`, `</${tag}\tignored='>'>`, `</${tag}/>`, `</${tag.toUpperCase()} >`]) {
    assert.deepEqual(coverage.cvTermsNotInJd([], `<h2>Skills</h2><${tag}>Hidden, <h2>Experience</h2>${ending}<p>Python</p>`, { html: true }), ['Python']);
  }
});

test('HTML tag attributes cannot forge skill headings or become skill terms', () => {
  const html = `<h2>Skills</h2><p data-note=\" > <h2>Experience</h2>\">Python, Java</p><h2>Experience</h2><p>Rust</p>`;
  assert.deepEqual(coverage.cvTermsNotInJd([], html, { html: true }), ['Python', 'Java']);
});

test('HTML comments and unterminated raw-text elements cannot expose example skills', () => {
  for (const tail of ['<script>Hidden, Terraform', '<style>Hidden, Terraform', '<!-- Hidden, Terraform']) {
    assert.deepEqual(coverage.cvTermsNotInJd([], `<h2>Skills</h2><p>Python</p>${tail}`, { html: true }), ['Python']);
  }
  assert.deepEqual(coverage.cvTermsNotInJd([], '<h2>Skills</h2><!-- Hidden --!><p>Python</p>', { html: true }), ['Python']);
});

test('inline HTML markup preserves adjacent letters while block elements separate skills', () => {
  const html = '<h2>Skills</h2><p>Post<strong>gre</strong>SQL</p><p>Type<em>Script</em></p><div>Terraform</div>';
  assert.deepEqual(coverage.cvTermsNotInJd([], html, { html: true }), ['PostgreSQL', 'TypeScript', 'Terraform']);
  assert.deepEqual(coverage.cvTermsNotInJd(['PostgreSQL', 'TypeScript'], html, { html: true }), ['Terraform']);
});

test('multiline HTML headings collapse whitespace without splitting the section name', () => {
  const html = '<h2>\n <strong>Technical</strong>\n Skills\n</h2><p>Python</p><h2>\n Work\n Experience\n</h2><p>Rust</p>';
  assert.deepEqual(coverage.cvTermsNotInJd([], html, { html: true }), ['Python']);
});

test('a nested recognized skill heading keeps its outer section boundary', () => {
  assert.deepEqual(coverage.cvTermsNotInJd([], '## Skills\n### Technical Skills\nPython\n### Tools\nTerraform\n## Experience\nRust'), ['Python', 'Terraform']);
  const html = '<h2>Skills</h2><h3>Technical Skills</h3><p>Python</p><h3>Tools</h3><p>Terraform</p><h2>Experience</h2><p>Rust</p>';
  assert.deepEqual(coverage.cvTermsNotInJd([], html, { html: true }), ['Python', 'Terraform']);
});

test('review searches each complete CV term within each JD keyword, not the reverse', () => {
  assert.deepEqual(coverage.cvTermsNotInJd(['Kubernetes'], '## Skills\nKubernetes orchestration'), ['Kubernetes orchestration']);
  assert.deepEqual(coverage.cvTermsNotInJd(['Kubernetes orchestration'], '## Skills\nKubernetes'), []);
});

test('HTML source whitespace stays within a skill term rather than creating a block boundary', () => {
  const html = '<h2>Skills</h2><p>Machine\n Learning, Data\t\n Science</p><p>Deep\n<strong> Learning</strong></p>';
  assert.deepEqual(coverage.cvTermsNotInJd([], html, { html: true }), ['Machine Learning', 'Data Science', 'Deep Learning']);
  assert.deepEqual(coverage.cvTermsNotInJd(['Machine Learning', 'Data Science', 'Deep Learning'], html, { html: true }), []);
});
