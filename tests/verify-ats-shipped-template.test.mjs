// tests/verify-ats-shipped-template.test.mjs — the default CV template audits
// clean under verify-ats, and the two template constructs that docked it are
// told apart from the evasions the checks exist for.
//
// Same class of bug as #4266/#4270: a CV built from templates/cv-template.html
// scored 92/100 with two warnings that came from the template itself, not from
// the candidate's content:
//   - 'Arial Unicode MS' (the Han-coverage fallback added in #6184) was not in
//     ATS_SAFE_FONTS, so every CV got "Non-standard font(s)";
//   - `.cv-consent:empty { display: none; }` (the optional consent footer) was
//     read as hidden text, although an `:empty` rule cannot hide any content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditAts } from '../verify-ats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const doc = (css, body = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>${css}</style></head><body>
<h1>Jane Doe</h1><p><a href="mailto:jane@example.com">jane@example.com</a> 555-010-0100</p>
<div class="section"><div class="section-title">Work Experience</div><p>Staff Engineer, Acme Corp (2020-present). Built and operated the core payments platform, reducing incident rates and improving deployment cadence across multiple engineering teams.</p></div>
<div class="section"><div class="section-title">Education</div><p>B.S. Computer Science, State University, 2018. Graduated with honors.</p></div>
<div class="section"><div class="section-title">Skills</div><p>Python, Kubernetes, Docker, PostgreSQL, distributed systems, CI/CD pipelines.</p></div>
${body}</body></html>`;

const ids = (html) => auditAts(html).issues.map((i) => i.id);

test('an :empty-only rule with display:none is not hidden text', () => {
  assert.ok(!ids(doc('body{font-family:Arial} .cv-consent:empty { display: none; }')).includes('hidden-text'));
});

test('display:none on a rule that can match content is still flagged', () => {
  assert.ok(ids(doc('body{font-family:Arial} .kw { display: none; }')).includes('hidden-text'));
  assert.ok(ids(doc('body{font-family:Arial} .cv-consent:empty, .kw { display: none; }')).includes('hidden-text'));
  assert.ok(ids(doc('body{font-family:Arial} @media print { .kw { display: none; } }')).includes('hidden-text'));
});

test('inline display:none is still flagged', () => {
  assert.ok(ids(doc('body{font-family:Arial}', '<span style="display:none">kw</span>')).includes('hidden-text'));
});

test('a CSS comment that mentions display:none is not a declaration', () => {
  assert.ok(!ids(doc('body{font-family:Arial} /* never use display:none here */')).includes('hidden-text'));
});

test('Arial Unicode MS, the template Han fallback, is not a non-standard font', () => {
  assert.ok(!ids(doc("body{font-family:Arial, 'Arial Unicode MS', sans-serif}")).includes('fonts'));
});

test('a CV built from the default template has no template-caused warnings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-ats-shipped-'));
  try {
    const input = join(dir, 'cv.json');
    const output = join(dir, 'cv.html');
    writeFileSync(input, JSON.stringify({
      lang: 'en',
      page_format: 'letter',
      candidate: { name: 'Jane Smith', email: 'jane@example.com', phone: '+1 415 555 0100', location: 'San Francisco, CA' },
      summary: 'Backend engineer who builds reliable payment systems.',
      competencies: ['Python', 'PostgreSQL'],
      experience: [{ company: 'Acme Corp', role: 'Staff Engineer', location: 'Remote', dates: '2020 - Present', bullets: ['Built the payments platform used by every product team.'] }],
      education: [{ title: 'B.S. Computer Science', org: 'State University', location: 'Berkeley, CA', year: '2018' }],
      skills: [{ category: 'Languages', items: 'Python, Go, SQL' }],
    }));
    const r = spawnSync(process.execPath, [join(ROOT, 'build-cv-html.mjs'), input, output, join(ROOT, 'templates', 'cv-template.html')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const found = ids(readFileSync(output, 'utf8'));
    assert.ok(!found.includes('fonts'), `fonts issue on the default template: ${found.join(', ')}`);
    assert.ok(!found.includes('hidden-text'), `hidden-text issue on the default template: ${found.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
