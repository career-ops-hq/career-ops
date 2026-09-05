import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(ROOT, 'templates');
const BASE_TEMPLATE = join(TEMPLATE_DIR, 'cv-template.html');

const ALL_TEMPLATES = readdirSync(TEMPLATE_DIR)
  .filter((f) => /^cv-template(\.[a-z-]+)?\.html$/.test(f))
  .map((f) => join(TEMPLATE_DIR, f));

function payload(title) {
  const candidate = { name: 'Test Candidate', email: 'test@example.com' };
  if (title !== undefined) candidate.title = title;
  return {
    lang: 'en', page_format: 'a4',
    candidate,
    summary: 'Test summary', competencies: ['Testing'],
    experience: [{ company: 'Test Co', role: 'Engineer', dates: '2026', bullets: ['Built tests.'] }],
    projects: [], education: [{ title: 'BSc', org: 'Test University', year: '2025' }],
    certifications: [], skills: [{ category: 'Tools', items: ['Node.js'] }],
  };
}

function render(inputPayload, template = BASE_TEMPLATE) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-title-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(inputPayload));
  execFileSync(process.execPath, ['build-cv-html.mjs', input, output, template], { cwd: ROOT, encoding: 'utf8' });
  return readFileSync(output, 'utf8');
}

test('a candidate.title renders a .header-title element right after the name', () => {
  const html = render(payload('Senior Backend Engineer'));
  assert.match(html, /<div class="header-title">Senior Backend Engineer<\/div>/);
  assert.match(html, /<h1>Test Candidate<\/h1>\s*<div class="header-title">/);
});

test('no title emits no .header-title element and leaves no placeholder', () => {
  for (const missing of [render(payload()), render(payload('')), render(payload('   '))]) {
    assert.doesNotMatch(missing, /<div class="header-title"/);
    assert.doesNotMatch(missing, /\{\{TITLE_BLOCK\}\}/);
  }
});

test('title text is HTML-escaped (no markup injection through the headline)', () => {
  const html = render(payload('Dev <script>alert(1)</script> & "Lead"'));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /Dev &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Lead&quot;/);
});

test('every built-in template carries the {{TITLE_BLOCK}} slot and resolves it', () => {
  for (const template of ALL_TEMPLATES) {
    const withTitle = render(payload('Platform Engineer'), template);
    assert.match(withTitle, /class="header-title">Platform Engineer</, `title missing in ${template}`);
    const withoutTitle = render(payload(), template);
    assert.doesNotMatch(withoutTitle, /\{\{TITLE_BLOCK\}\}/, `unresolved slot in ${template}`);
    assert.doesNotMatch(withoutTitle, /<div class="header-title"/, `stray title markup in ${template}`);
  }
});
