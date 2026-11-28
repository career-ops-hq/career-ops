// tests/archived-jd-posting-headings.test.mjs — the archived JD section ends at
// the next report section, not at a heading inside the posting.
//
// A posting pasted verbatim keeps its own `## Requirements` heading.
// keyword-match.mjs and interview-jd-terms.mjs ended the section at any `## `
// line, so every skill listed under that heading was lost: keyword-match's
// fallback scored none of them, and interview-jd-terms counted none of them
// (or dropped the JD outright when the text above it was short).
// lib/jd-archive-section.mjs already defines the boundary check-jd-archive.mjs
// uses; both readers now use it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archivedJdText, keywordsFromJdText } from '../keyword-match.mjs';
import { jdFromReport } from '../interview-jd-terms.mjs';

const report = (jd, after = '## Machine Summary\n\n```yaml\nscore: 4.1\n```\n') => [
  '# Evaluation: Acme — Platform Engineer',
  '',
  '**Score:** 4.1/5',
  '',
  '## A) Role Summary',
  '',
  'Platform role.',
  '',
  '## Job Description (archived verbatim)',
  '',
  jd,
  '',
  after,
].join('\n');

const POSTING = [
  'Acme is hiring a Platform Engineer to run our infrastructure.',
  '',
  '## Requirements',
  '',
  '- 5+ years with Kubernetes and Terraform',
  '- Strong Python and PostgreSQL',
].join('\n');

test('keyword-match keeps the text under the posting\'s own headings', () => {
  const jd = archivedJdText(report(POSTING), tmpdir());
  assert.match(jd, /## Requirements/);
  assert.match(jd, /Kubernetes and Terraform/);
  assert.doesNotMatch(jd, /Machine Summary|score: 4\.1/);
  assert.deepEqual(keywordsFromJdText(jd).sort(), ['Kubernetes', 'PostgreSQL', 'Python', 'Terraform']);
});

test('interview-jd-terms keeps the text under the posting\'s own headings', () => {
  const jd = jdFromReport(report(POSTING));
  assert.match(jd, /Kubernetes and Terraform/);
  assert.doesNotMatch(jd, /Machine Summary|score: 4\.1/);
});

test('interview-jd-terms no longer drops a JD whose first heading comes early', () => {
  const posting = ['Platform Engineer', '', '## What you bring', '', '- Kubernetes, Terraform and Go in production for five years'].join('\n');
  assert.match(jdFromReport(report(posting)), /Kubernetes, Terraform and Go/);
});

test('control: the section still ends at the next report section, or at end of file', () => {
  const tail = report('Plain posting text with no headings, long enough to count as a JD.', '## Risk Summary\n\nNone.\n');
  assert.doesNotMatch(archivedJdText(tail, tmpdir()), /Risk Summary|None\./);
  assert.doesNotMatch(jdFromReport(tail), /Risk Summary|None\./);
  const last = report(POSTING, '');
  assert.match(archivedJdText(last, tmpdir()), /PostgreSQL/);
  assert.match(jdFromReport(last), /PostgreSQL/);
});

test('control: a pointer to a jds/ capture is still followed', () => {
  const root = mkdtempSync(join(tmpdir(), 'archived-jd-pointer-'));
  try {
    mkdirSync(join(root, 'jds'));
    writeFileSync(join(root, 'jds', '041-acme.md'), 'Captured posting: Rust and Kafka.');
    assert.equal(archivedJdText(report('See jds/041-acme.md for the full archive.'), root), 'Captured posting: Rust and Kafka.');
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
