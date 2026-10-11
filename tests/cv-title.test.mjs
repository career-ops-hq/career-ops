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

// listTemplates() is the same registry build-cv-html.mjs's callers resolve
// names against, so this walks the flat cv-template*.html files AND one-level
// packs (templates/ats/cv-template.ats.html) without hand-rolling a second
// discovery rule that can drift from the real one (nikitacometa's #3763
// review: a bare readdirSync + regex saw 7 files and reported "all 8" while
// silently skipping the ats pack). resume-template.html sits outside this
// registry by design — templates/README.md documents it as a hand-mirrored,
// filename-invoked variant of cv-template.html, not a named/kind-resolved
// template — so it is added explicitly rather than discovered.
const ALL_TEMPLATES = [
  ...listTemplates('cv', { dir: TEMPLATE_DIR, format: 'html' }).map((entry) => entry.path),
  join(TEMPLATE_DIR, 'resume-template.html'),
];

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

test('no title leaves no blank line where the slot sat (byte-identical to before, CodeRabbit #3763)', () => {
  // Matching only the {{TITLE_BLOCK}} token (as every other placeholder does)
  // would remove the token but leave its own line — an indented, now-empty
  // line — between the name and whatever follows it. h1 must be immediately
  // followed by its next real line, with no blank line in between.
  const html = render(payload());
  // [ \t]*, not \s*: \s would also match the blank line's own trailing
  // newline and keep scanning past it, silently passing on the very bug this
  // pins. Only inline whitespace may sit between the h1's newline and the
  // next real character.
  assert.match(html, /<h1>Test Candidate<\/h1>\n[ \t]*\S/, 'no blank line survives between the name and the next element');
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
