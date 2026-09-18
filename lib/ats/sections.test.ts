import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeSectionHeading, matchSectionHeading, detectResumeSections } from './sections.ts';
import { auditATSCompatibility } from '../latex/parser.ts';

test('normalizeSectionHeading handles uppercase, punctuation, whitespace, and LaTeX', () => {
  assert.strictEqual(normalizeSectionHeading('EDUCATION'), 'education');
  assert.strictEqual(normalizeSectionHeading('Education'), 'education');
  assert.strictEqual(normalizeSectionHeading(' education '), 'education');
  assert.strictEqual(normalizeSectionHeading('PROFESSIONAL EXPERIENCE'), 'professional experience');
  assert.strictEqual(normalizeSectionHeading('TECHNICAL SKILLS'), 'technical skills');
  assert.strictEqual(normalizeSectionHeading('EDUCATION:'), 'education');
  assert.strictEqual(normalizeSectionHeading('EDUCATION |'), 'education');
  assert.strictEqual(normalizeSectionHeading('EDUCATION -'), 'education');
  assert.strictEqual(normalizeSectionHeading('EDUCATION —'), 'education');
  assert.strictEqual(normalizeSectionHeading('EDUCATION & QUALIFICATIONS'), 'education and qualifications');
  assert.strictEqual(normalizeSectionHeading('\\section{EDUCATION}'), 'education');
  assert.strictEqual(normalizeSectionHeading('\\section{Work Experience}'), 'work experience');
  assert.strictEqual(normalizeSectionHeading('E D U C A T I O N'), 'education');
  assert.strictEqual(normalizeSectionHeading('PROFESSIONAL   EXPERIENCE\n'), 'professional experience');
});

test('matchSectionHeading returns correct confidence and standard flags', () => {
  const matchEdu = matchSectionHeading('EDUCATION');
  assert.ok(matchEdu);
  assert.strictEqual(matchEdu.sectionKey, 'education');
  assert.strictEqual(matchEdu.canonicalName, 'Education');
  assert.strictEqual(matchEdu.standard, true);
  assert.strictEqual(matchEdu.confidence, 1.0);

  const matchExp = matchSectionHeading('PROFESSIONAL EXPERIENCE');
  assert.ok(matchExp);
  assert.strictEqual(matchExp.sectionKey, 'experience');
  assert.strictEqual(matchExp.canonicalName, 'Work Experience');
  assert.strictEqual(matchExp.standard, true);
  assert.strictEqual(matchExp.confidence, 1.0);

  const matchCert = matchSectionHeading('CERTIFICATES');
  assert.ok(matchCert);
  assert.strictEqual(matchCert.sectionKey, 'certifications');
  assert.strictEqual(matchCert.standard, true);
});

test('TEST 1: Uppercase standard headings (EDUCATION, EXPERIENCE, PROJECTS, SKILLS)', () => {
  const lines = ['EDUCATION', 'University of California', 'EXPERIENCE', 'Software Engineer', 'PROJECTS', 'AI App', 'SKILLS', 'TypeScript, Python'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundKeys = sections.filter(s => s.found).map(s => s.key);
  
  assert.ok(foundKeys.includes('education'));
  assert.ok(foundKeys.includes('experience'));
  assert.ok(foundKeys.includes('projects'));
  assert.ok(foundKeys.includes('skills'));
  assert.strictEqual(sections.find(s => s.key === 'education')?.standard, true);
});

test('TEST 2: Title case standard headings (Education, Professional Experience, Technical Skills, Projects)', () => {
  const lines = ['Education', 'BS CS', 'Professional Experience', 'Senior Dev', 'Technical Skills', 'React', 'Projects', 'Open Source'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundKeys = sections.filter(s => s.found).map(s => s.key);

  assert.ok(foundKeys.includes('education'));
  assert.ok(foundKeys.includes('experience'));
  assert.ok(foundKeys.includes('skills'));
  assert.ok(foundKeys.includes('projects'));
});

test('TEST 3: Headings with trailing colons (EDUCATION:, WORK EXPERIENCE:, TECHNICAL SKILLS:, SELECTED PROJECTS:)', () => {
  const lines = ['EDUCATION:', 'BS CS', 'WORK EXPERIENCE:', 'Developer', 'TECHNICAL SKILLS:', 'Node.js', 'SELECTED PROJECTS:', 'Fullstack App'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundKeys = sections.filter(s => s.found).map(s => s.key);

  assert.ok(foundKeys.includes('education'));
  assert.ok(foundKeys.includes('experience'));
  assert.ok(foundKeys.includes('skills'));
  assert.ok(foundKeys.includes('projects'));
});

test('TEST 4: Alias headings (Academic Background, Employment History, Core Competencies, Personal Projects)', () => {
  const lines = ['Academic Background', 'MIT', 'Employment History', 'Tech Corp', 'Core Competencies', 'Leadership', 'Personal Projects', 'Side App'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundKeys = sections.filter(s => s.found).map(s => s.key);

  assert.ok(foundKeys.includes('education'));
  assert.ok(foundKeys.includes('experience'));
  assert.ok(foundKeys.includes('skills'));
  assert.ok(foundKeys.includes('projects'));
});

test('TEST 5: Core headings (EDUCATION, EXPERIENCE, SKILLS)', () => {
  const lines = ['EDUCATION', 'Berkeley', 'EXPERIENCE', 'Engineer', 'SKILLS', 'Java, SQL'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundKeys = sections.filter(s => s.found).map(s => s.key);

  assert.ok(foundKeys.includes('education'));
  assert.ok(foundKeys.includes('experience'));
  assert.ok(foundKeys.includes('skills'));
});

test('TEST 6: Random text without identifiable sections', () => {
  const lines = ['This is just a story about a developer who loves writing code.', 'Education is important for everyone.', 'I have many years of work experience in software.'];
  const sections = detectResumeSections(lines, lines.join('\n'));
  const foundRequired = sections.filter(s => !s.isOptional && s.found);

  assert.strictEqual(foundRequired.length, 0);
});

test('TEST 7: GigPilot LaTeX Resume with Uppercase \\section{} tags', () => {
  const latexSource = `
\\documentclass[letterpaper,11pt]{article}
\\begin{document}
\\section{EDUCATION}
University of California
\\section{EXPERIENCE}
Senior Engineer at Acme Corp
\\section{PROJECTS}
ATS Resume Analyzer
\\section{SKILLS}
TypeScript, Python, Node.js
\\section{CERTIFICATES}
AWS Certified Solutions Architect
\\end{document}
  `;

  const report = auditATSCompatibility(latexSource);
  const headingsCheck = report.checks.find(c => c.id === 'standardHeadings');
  
  assert.ok(headingsCheck);
  assert.strictEqual(headingsCheck.passed, true);
  assert.ok(headingsCheck.details.includes('Education'));
  assert.ok(headingsCheck.details.includes('Work Experience'));
  assert.ok(headingsCheck.details.includes('Projects'));
  assert.ok(headingsCheck.details.includes('Skills'));
});
