// tests/cv-brace-placeholder-text.test.mjs — candidate text that looks like a
// {{PLACEHOLDER}} must render as text, not be filled as one.
//
// build-cv-html fills the template by successive {{KEY}} replacements over the
// whole document, in a fixed order. escapeHtml covered &, <, >, and quotes but
// left braces alone, so escaped candidate text was scanned by every replacement
// after its own:
//   company "Acme {{BULLETS}} Corp"  -> the bullet list spliced into the company
//                                      span, and the build still said valid
//   summary naming {{SKILLS}}        -> the skills grid inside the summary
//   bullet about "{{FIRST_NAME}}"    -> the build failed: "Unresolved
//                                      placeholders: {{FIRST_NAME}}"
// The last is ordinary marketing-ops and templating vocabulary. The same
// family as cv-dollar-pattern.test.mjs: text that means something to the
// fill machinery has to reach it as plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function build(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-brace-'));
  try {
    const input = join(dir, 'p.json');
    const out = join(dir, 'out.html');
    writeFileSync(input, JSON.stringify({
      lang: 'en',
      page_format: 'letter',
      candidate: { name: 'Test Candidate', email: 't@example.com' },
      competencies: ['Cloud'],
      projects: [], education: [], certifications: [], awards: [],
      skills: [{ category: 'Languages', items: ['Go', 'Rust'] }],
      ...payload,
    }));
    execFileSync(process.execPath, [join(ROOT, 'build-cv-html.mjs'), input, out], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return readFileSync(out, 'utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The text of the first element with this class, entities decoded. */
function textOf(html, cls) {
  const m = new RegExp(`<[a-z]+ class="${cls}">([\\s\\S]*?)</`).exec(html);
  assert.ok(m, `no .${cls} element in the output`);
  return m[1]
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

test('a company naming {{BULLETS}} renders as text, not as the bullet list', () => {
  const html = build({
    summary: 'Backend engineer.',
    experience: [{ company: 'Acme {{BULLETS}} Corp', role: 'Engineer', dates: '2024', bullets: ['Did a thing', 'Did another'] }],
  });
  assert.equal(textOf(html, 'job-company'), 'Acme {{BULLETS}} Corp');
  // The bullets still render once, in their own list.
  assert.equal((html.match(/Did a thing/g) || []).length, 1);
});

test('a summary naming {{SKILLS}} renders as text, not as the skills grid', () => {
  const html = build({
    summary: 'Top performer {{SKILLS}} and more.',
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: ['Did a thing'] }],
  });
  assert.equal(textOf(html, 'summary-text'), 'Top performer {{SKILLS}} and more.');
  assert.equal((html.match(/class="skills-grid"/g) || []).length, 1, 'the skills grid renders once, in its own section');
});

test('a bullet naming an unknown {{FIRST_NAME}} builds instead of failing as unresolved', () => {
  // Before the fix this exited non-zero with "Unresolved placeholders: {{FIRST_NAME}}".
  const html = build({
    summary: 'Marketing operations lead.',
    experience: [{ company: 'Acme', role: 'Lifecycle Marketer', dates: '2024', bullets: ['Built email campaigns with {{FIRST_NAME}} merge fields'] }],
  });
  assert.match(html, /Built email campaigns with &#123;&#123;FIRST_NAME&#125;&#125; merge fields/);
  // The guard itself still works: nothing the template left unfilled survives.
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
});
