// tests/cv-empty-summary.test.mjs: build-cv-html.mjs drops the Professional
// Summary block, heading and container, when the payload's summary renders no
// text (#5019). tests/cv-optional-sections.test.mjs covers the strip itself;
// this drives the CLI from payload to written file, and checks an empty
// summary against every shipped HTML template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates } from '../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(ROOT, 'templates');
const BASE_TEMPLATE = join(TEMPLATE_DIR, 'cv-template.html');

// The same template set cv-title.test.mjs walks: every registered HTML CV
// template, packs included, plus resume-template.html, which sits outside the
// registry by design.
const ALL_TEMPLATES = [
  ...listTemplates('cv', { dir: TEMPLATE_DIR, format: 'html' }).map((entry) => entry.path),
  join(TEMPLATE_DIR, 'resume-template.html'),
];

const SUMMARY_MARKER = '<!-- PROFESSIONAL SUMMARY -->';
const SUMMARY_ELEMENT = /class="summary-text"/;
const SUMMARY_HEADING = />Professional Summary</;

function payload(summary) {
  const out = {
    lang: 'en', page_format: 'a4',
    candidate: { name: 'Test Candidate', email: 'test@example.com' },
    competencies: ['Testing'],
    experience: [{ company: 'Test Co', role: 'Engineer', dates: '2026', bullets: ['Built tests.'] }],
    education: [{ title: 'BSc', org: 'Test University', year: '2025' }],
    skills: [{ category: 'Tools', items: ['Node.js'] }],
  };
  if (summary !== undefined) out.summary = summary;
  return out;
}

function render(inputPayload, template = BASE_TEMPLATE) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-empty-summary-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(inputPayload));
  execFileSync(process.execPath, ['build-cv-html.mjs', input, output, template], { cwd: ROOT, encoding: 'utf8' });
  return readFileSync(output, 'utf8');
}

function assertNoSummary(html, label) {
  assert.ok(!html.includes(SUMMARY_MARKER), `${label}: the summary marker is gone`);
  assert.doesNotMatch(html, SUMMARY_ELEMENT, `${label}: no summary-text element`);
  assert.doesNotMatch(html, SUMMARY_HEADING, `${label}: no Professional Summary heading`);
  assert.match(html, /Built tests\./, `${label}: the experience below it still renders`);
}

test('an empty, whitespace-only or absent summary leaves no summary block', () => {
  for (const [label, summary] of [['empty', ''], ['whitespace-only', ' \n\t '], ['absent', undefined]]) {
    assertNoSummary(render(payload(summary)), label);
  }
});

test('every shipped HTML template drops an empty summary', () => {
  for (const template of ALL_TEMPLATES) {
    assertNoSummary(render(payload(''), template), template.slice(ROOT.length + 1));
  }
});

test('a populated summary still renders under its heading', () => {
  const html = render(payload('Engineer who ships tests.'));
  assert.ok(html.includes(SUMMARY_MARKER));
  assert.match(html, SUMMARY_HEADING);
  assert.match(html, /<div class="summary-text">Engineer who ships tests\.<\/div>/);
});

test('a numeric summary renders its value, like any other scalar field', () => {
  assert.match(render(payload(2026)), /<div class="summary-text">2026<\/div>/);
  assert.match(render(payload(0)), /<div class="summary-text">0<\/div>/);
});
