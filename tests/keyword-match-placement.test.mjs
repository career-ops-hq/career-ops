// tests/keyword-match-placement.test.mjs — keyword-match: report where a
// present keyword landed, not how often it appears (#7066).
//
// Acceptance criteria:
// 1. For each present keyword, report the section(s) it appears in using the
//    CV's own headings: Summary, Competencies or Skills, and Experience by
//    entry (company) and bullet position (e.g. Kubernetes: Skills; Acme, bullet 1).
// 2. Reuse findExperienceSections and parseCompanyHeading from lib/cv-markdown.mjs
//    so the checks share one parser.
// 3. Graceful fallback: when CV structure or headings cannot be determined,
//    report "placement wasn't determined" rather than guessing.
// 4. Purely informational: coverage percentages, thresholds, and CLI exit codes
//    remain completely untouched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeCoverage, locateKeywordPlacements, formatCoverageMarkdown } from '../keyword-match.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nkeyword-match: keyword placement reporting (#7066)');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const sampleCv = `
# Jane Doe
Engineer & Cloud Architect

## Professional Summary
Senior engineer with 8 years building Python microservices and orchestrating Kubernetes clusters.

## Experience

### Acme Health --- New York, NY
**Staff Infrastructure Engineer**
2021 -- Present

- Architected Kubernetes platform across multiple AWS regions.
- Automated CI/CD pipelines with GitHub Actions and Terraform.
- Built internal developer portal using Go and Python.

### Beta FinTech -- London, UK
**Software Engineer**
2018 -- 2021

- Designed and optimized PostgreSQL database queries for high-throughput trading.
- Deployed distributed Python microservices using Docker and Redis.

## Core Competencies
- Cloud: Kubernetes, AWS, Docker, Terraform
- Languages: Python, Go, SQL, Bash
- Databases: PostgreSQL, Redis
`;

check('locates keywords across Summary, Experience bullets, and Skills sections', () => {
  const result = locateKeywordPlacements(['Kubernetes', 'Python', 'Terraform', 'PostgreSQL'], sampleCv);

  assert.deepEqual(result['Kubernetes'], [
    'Professional Summary',
    'Acme Health, bullet 1',
    'Core Competencies',
  ]);

  assert.deepEqual(result['Python'], [
    'Professional Summary',
    'Acme Health, bullet 3',
    'Beta FinTech, bullet 2',
    'Core Competencies',
  ]);

  assert.deepEqual(result['Terraform'], [
    'Acme Health, bullet 2',
    'Core Competencies',
  ]);

  assert.deepEqual(result['PostgreSQL'], [
    'Beta FinTech, bullet 1',
    'Core Competencies',
  ]);
});

check('reports multiple bullets within the same company in bullet order', () => {
  const multiBulletCv = `
## Experience

### Widget Corp -- Austin, TX
**Backend Lead**
2020 -- 2023

- Wrote Go microservices for real-time order processing.
- Mentored junior engineers and conducted code reviews.
- Maintained legacy Go services during cloud migration.
`;
  const result = locateKeywordPlacements(['Go'], multiBulletCv);
  assert.deepEqual(result['Go'], [
    'Widget Corp, bullet 1',
    'Widget Corp, bullet 3',
  ]);
});

check('maps keywords in company heading or title before bullet 1 to the company name', () => {
  const titleCv = `
## Work Experience

### CloudOps Systems -- Boston, MA
**Principal Kubernetes Architect**
2020 -- 2024

- Led cross-functional platform modernization initiative.
- Reduced cloud compute spending by 35%.
`;
  const result = locateKeywordPlacements(['Kubernetes', 'CloudOps Systems'], titleCv);
  assert.deepEqual(result['Kubernetes'], ['CloudOps Systems']);
  assert.deepEqual(result['CloudOps Systems'], ['CloudOps Systems']);
});

check('handles various dash styles in company headings (em-dash, en-dash, double/triple hyphen)', () => {
  const dashCv = `
## Experience

### Alpha Corp — San Francisco, CA
- Implemented Docker containers.

### Beta Corp – Seattle, WA
- Managed Docker swarms.

### Gamma Corp -- Chicago, IL
- Deployed Docker images.

### Delta Corp --- Denver, CO
- Standardized Docker registries.
`;
  const result = locateKeywordPlacements(['Docker'], dashCv);
  assert.deepEqual(result['Docker'], [
    'Alpha Corp, bullet 1',
    'Beta Corp, bullet 1',
    'Gamma Corp, bullet 1',
    'Delta Corp, bullet 1',
  ]);
});

check('falls back to "placement wasn\'t determined" for unstructured CV text without headings', () => {
  const flatCv = 'Senior software engineer with 10 years experience in Python and Kubernetes.';
  const result = locateKeywordPlacements(['Python', 'Kubernetes'], flatCv);

  assert.deepEqual(result['Python'], ["placement wasn't determined"]);
  assert.deepEqual(result['Kubernetes'], ["placement wasn't determined"]);
});

check('falls back to "placement wasn\'t determined" when keyword only appears outside sections', () => {
  const preambleCv = `
Jane Doe — Kubernetes specialist

## Education
B.S. in Computer Science
`;
  const result = locateKeywordPlacements(['Kubernetes'], preambleCv);
  assert.deepEqual(result['Kubernetes'], ["placement wasn't determined"]);
});

check('does not read keywords from HTML comments or fenced code blocks', () => {
  const commentCv = `
## Summary
Software engineer.

<!-- Kubernetes is mentioned in a hidden comment -->
\`\`\`
code block mentions Terraform
\`\`\`

## Skills
- Python
`;
  const result = locateKeywordPlacements(['Kubernetes', 'Terraform', 'Python'], commentCv);
  assert.deepEqual(result['Kubernetes'], ["placement wasn't determined"]);
  assert.deepEqual(result['Terraform'], ["placement wasn't determined"]);
  assert.deepEqual(result['Python'], ['Skills']);
});

check('analyzeCoverage includes placement without mutating coverage percentages or counts', () => {
  const keywords = ['Python', 'Kubernetes', 'Java'];
  const coverage = analyzeCoverage(keywords, sampleCv);

  assert.equal(coverage.total, 3);
  assert.equal(coverage.presentCount, 2);
  assert.equal(coverage.coveragePct, 67);
  assert.deepEqual(coverage.present, ['Python', 'Kubernetes']);
  assert.deepEqual(coverage.missing, ['Java']);
  assert.ok(coverage.placement, 'placement record must exist');
  assert.deepEqual(coverage.placement['Kubernetes'], [
    'Professional Summary',
    'Acme Health, bullet 1',
    'Core Competencies',
  ]);
  assert.equal(coverage.placement['Java'], undefined, 'missing keyword not in placement');
});

check('formatCoverageMarkdown renders placement under present keywords and keeps diagnostic disclaimer', () => {
  const coverage = analyzeCoverage(['Python', 'Kubernetes', 'Java'], sampleCv);
  const rendered = formatCoverageMarkdown(coverage, 'cv.md', null);

  assert.match(rendered, /\*\*ATS coverage: 67%\*\* \(2\/3 keywords present\)/);
  assert.match(rendered, /\*\*Present \(2\):\*\* Python, Kubernetes/);
  assert.match(rendered, /- Python: Professional Summary; Acme Health, bullet 3; Beta FinTech, bullet 2; Core Competencies/);
  assert.match(rendered, /- Kubernetes: Professional Summary; Acme Health, bullet 1; Core Competencies/);
  assert.match(rendered, /\*\*Missing \(1\):\*\* Java/);
  assert.match(rendered, /Diagnostic only/);
});

check('formatCoverageMarkdown renders graceful fallback when placement is undetermined', () => {
  const coverage = analyzeCoverage(['Python'], 'Python engineer with no markdown headings.');
  const rendered = formatCoverageMarkdown(coverage, 'cv.md', null);

  assert.match(rendered, /- Python: placement wasn't determined/);
});

check('CLI output includes placement in --json mode without affecting exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyword-placement-'));
  const reportPath = join(dir, 'report.md');
  const cvPath = join(dir, 'cv.md');

  writeFileSync(reportPath, '# Scored Role\n\n## Keywords extracted\n\n- Python\n- Kubernetes\n- Rust\n');
  writeFileSync(cvPath, sampleCv);

  const res = spawnSync(process.execPath, [
    join(ROOT, 'keyword-match.mjs'),
    reportPath,
    '--cv', cvPath,
    '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_ROOT: dir },
  });

  assert.equal(res.status, 0, `CLI exited with code ${res.status}: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.coveragePct, 67);
  assert.deepEqual(parsed.present, ['Python', 'Kubernetes']);
  assert.deepEqual(parsed.missing, ['Rust']);
  assert.ok(parsed.placement);
  assert.deepEqual(parsed.placement['Kubernetes'], [
    'Professional Summary',
    'Acme Health, bullet 1',
    'Core Competencies',
  ]);
  assert.deepEqual(parsed.placement['Python'], [
    'Professional Summary',
    'Acme Health, bullet 3',
    'Beta FinTech, bullet 2',
    'Core Competencies',
  ]);
});
