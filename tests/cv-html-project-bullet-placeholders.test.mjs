// tests/cv-html-project-bullet-placeholders.test.mjs — project bullet fallback
// text may carry literal {{TOKENS}} from user data. Those are data, not
// template placeholders, and must not trip build-cv-html's unresolved-token
// guard when project descriptions are synthesized from bullets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

function payload(projects) {
  return {
    lang: 'en',
    page_format: 'letter',
    candidate: { name: 'Placeholder Canary', email: 'canary@example.com' },
    summary: 'Summary.',
    competencies: ['Testing'],
    experience: [{ company: 'Example Co', role: 'Engineer', dates: '2026', bullets: ['Shipped safely.'] }],
    projects,
    education: [],
    certifications: [],
    awards: [],
    skills: [],
  };
}

function render(dir, label, projects, template) {
  const input = join(dir, `${label}.json`);
  const output = join(dir, `${label}.html`);
  const args = [join(ROOT, 'build-cv-html.mjs'), input, output];
  if (template) args.push(template);
  writeFileSync(input, JSON.stringify(payload(projects)));
  execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return readFileSync(output, 'utf8');
}

test('single project bullet preserves literal placeholders through partial DESC_BLOCK', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-project-placeholder-partial-'));
  try {
    const html = render(dir, 'partial', [
      { name: 'Launch Notes', bullets: ['Keep {{CONSENT}} literal for the operator.'] },
    ]);

    assert.match(html, /Keep &#123;&#123;CONSENT&#125;&#125; literal for the operator\./);
    assert.doesNotMatch(html, /\{\{CONSENT\}\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project bullet placeholder preservation also covers the no-partial fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-project-placeholder-fallback-'));
  try {
    const packDir = join(dir, 'templates');
    cpSync(join(ROOT, 'templates'), packDir, { recursive: true });
    unlinkSync(join(packDir, 'sections', 'projects.html'));

    const html = render(dir, 'fallback', [
      { name: 'Fallback Notes', bullets: ['Fallback keeps {{CONSENT}} literal.'] },
    ], join(packDir, 'cv-template.html'));

    assert.match(html, /Fallback keeps &#123;&#123;CONSENT&#125;&#125; literal\./);
    assert.doesNotMatch(html, /\{\{CONSENT\}\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
