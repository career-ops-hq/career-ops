// tests/check-jd-archive-paraphrase.test.mjs - a report whose "## Job Description"
// section admits it is a paraphrase is flagged, with the reason named, unless a
// jds/ capture backs it (#5179).
//
// Run:  node --test tests/check-jd-archive-paraphrase.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJdArchive, hasEmbeddedJdArchive, detectJdSectionMarker } from '../check-jd-archive.mjs';

const archivedReport = (body, heading = 'Job Description (archived verbatim)') => `# Evaluation: ExampleCo — Analyst\n\n## ${heading}\n${body}\n`;

test('explicit full-posting omission and incomplete archive disclosures are not embedded archives', () => {
  for (const text of [
    'Full reproduction of the source job description is omitted due to copyright limits.',
    'This section is not a completed JD archive.',
    'Full reproduction omitted due to copyright restrictions; the original source remains available at the posting URL.',
    'The full text is not reproduced here because of the source copyright restriction.',
    'The full job description cannot be reproduced due to a quotation limit.',
  ]) {
    const report = archivedReport(text);
    assert.equal(hasEmbeddedJdArchive(report), false, text);
    assert.equal(detectJdSectionMarker(report)?.category, 'omission', text);
  }
});

test('a not-archived heading is an evaluator disclosure rather than a full-archive claim', () => {
  const report = archivedReport('The source was available during evaluation, but its full text was not saved in this report.', 'Job Description (not archived)');
  assert.equal(hasEmbeddedJdArchive(report), false);
  assert.equal(detectJdSectionMarker(report)?.category, 'omission');
});

test('genuine JD copyright notices and archive responsibilities remain valid source content', () => {
  for (const text of [
    'The Analyst maintains copyright notices and archive retention duties for customer documentation. You will work with engineering and legal teams to deliver reliable records.',
    'Full reproduction rights are granted to staff working on digitisation. You will archive incomplete historic records, manage permissions and document retention exceptions. Copyright ExampleCo.',
  ]) {
    const report = archivedReport(text);
    assert.equal(hasEmbeddedJdArchive(report), true, text);
    assert.equal(detectJdSectionMarker(report), null, text);
  }
});

const PARAPHRASE_REPORT = [
  '# Evaluation: Acme - Director of Marketing',
  '',
  '## Job Description (archived verbatim)',
  '',
  'Note: the fetch tool would not return the literal text. What follows is a close paraphrase, not a literal copy.',
  '',
  'Title: Director of Marketing. Owns demand generation, reports to the CMO, manages a team of eight.',
  '',
  '## Machine Summary',
  '',
].join('\n');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'jd-paraphrase-'));
  const reportsDir = join(dir, 'reports');
  const jdsDir = join(dir, 'jds');
  mkdirSync(reportsDir);
  mkdirSync(jdsDir);
  writeFileSync(join(reportsDir, '042-acme-2026-01-15.md'), PARAPHRASE_REPORT);
  return { dir, reportsDir, jdsDir };
}

test('a self-declared paraphrase under a verbatim heading is flagged, naming the reason', () => {
  const { dir, reportsDir, jdsDir } = fixture();
  try {
    const { findings } = checkJdArchive(reportsDir, jdsDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, 'missing-jd-archive');
    assert.match(findings[0].detail, /says it is a paraphrase or restatement/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same report passes once a report-numbered jds/ capture exists', () => {
  const { dir, reportsDir, jdsDir } = fixture();
  try {
    writeFileSync(join(jdsDir, '042-2026-01-15_acme_director-of-marketing.md'), 'captured posting text');
    const { findings } = checkJdArchive(reportsDir, jdsDir);
    assert.deepEqual(findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PDF_POINTER_REPORT = [
  '# Evaluation: Acme - Director of Marketing',
  '',
  '## Job Description (archived verbatim)',
  '',
  'See jds/042-2026-01-15_acme_director.pdf for the full archive (archive-posting.mjs --report=42).',
  '',
  '## Machine Summary',
  '',
].join('\n');

test('a PDF pointer with no capture on disk is flagged, and passes once the capture exists', () => {
  const { dir, reportsDir, jdsDir } = fixture();
  try {
    writeFileSync(join(reportsDir, '042-acme-2026-01-15.md'), PDF_POINTER_REPORT);
    assert.equal(checkJdArchive(reportsDir, jdsDir).findings.length, 1);
    writeFileSync(join(jdsDir, '042-2026-01-15_acme_director.pdf'), 'pdf bytes');
    assert.deepEqual(checkJdArchive(reportsDir, jdsDir).findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { mapTrackerCaptureLinks } from '../check-jd-archive.mjs';

test('a tracker capture link cannot escape the data root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jd-traversal-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'jds'));
    writeFileSync(join(dir, 'outside.pdf'), 'not a capture');
    const tracker = join(root, 'data', 'applications.md');
    const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
    writeFileSync(tracker, `${header}| 42 | 2026-01-15 | Acme | Director | 4.0/5 | Applied | no | [42](jds/../../outside.pdf) | |\n`);
    assert.equal(mapTrackerCaptureLinks(tracker, join(root, 'jds')).size, 0);
    writeFileSync(join(root, 'jds', 'outside.pdf'), 'same-named capture in jds/');
    assert.equal(mapTrackerCaptureLinks(tracker, join(root, 'jds')).size, 0);
    writeFileSync(join(root, 'jds', 'inside.pdf'), 'capture');
    writeFileSync(tracker, `${header}| 42 | 2026-01-15 | Acme | Director | 4.0/5 | Applied | no | [42](jds/inside.pdf) | |\n`);
    assert.equal(mapTrackerCaptureLinks(tracker, join(root, 'jds')).size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
