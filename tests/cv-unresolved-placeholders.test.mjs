// tests/cv-unresolved-placeholders.test.mjs — renderHtml must not ship a
// literal {{token}} from the template into a rendered CV.
//
// PLACEHOLDER_RE only recognised {{UPPER_SNAKE}}. A custom template carrying
// {{role_title}} or {{ COMPANY }} rendered that text verbatim, and the build
// still reported valid. The guard that catches those reads the template
// before it is filled: a scan of the filled HTML cannot tell an unfilled
// template token from candidate text that quotes one, such as {{ .Values.x }}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function payload(extra = {}) {
  return {
    lang: 'en',
    page_format: 'letter',
    candidate: { name: 'Test Candidate', email: 't@example.com' },
    summary: 'Backend engineer.',
    competencies: ['Cloud'],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    skills: [{ category: 'Languages', items: ['Go'] }],
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: ['Did a thing'] }],
    ...extra,
  };
}

function run(body, template) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-placeholder-'));
  try {
    const input = join(dir, 'p.json');
    const out = join(dir, 'out.html');
    const args = [join(ROOT, 'build-cv-html.mjs'), input, out];
    writeFileSync(input, JSON.stringify(body));
    if (template != null) {
      const tpl = join(dir, 'template.html');
      writeFileSync(tpl, template);
      args.push(tpl);
    }
    const res = spawnSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const html = res.status === 0 ? readFileSync(out, 'utf-8') : '';
    // Keep the spawn fields (error, signal, status, streams) so exitedNonZero
    // can tell a chosen non-zero exit from a timeout kill.
    return { ...res, html };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a template token in any double-brace shape that does not resolve fails and names the token', () => {
  const tpl = `<!DOCTYPE html><html lang="{{LANG}}"><body>
    <h1>{{NAME}}</h1>
    <p>{{SUMMARY_TEXT}}</p>
    <p>{{role_title}}</p>
    <p>{{ COMPANY }}</p>
  </body></html>`;
  const res = run(payload(), tpl);
  assert.ok(exitedNonZero(res), describeSpawn(res, 'an unresolved template token must fail the build'));
  assert.match(res.stderr, /Unresolved placeholders: \{\{role_title\}\}, \{\{ COMPANY \}\}/);
});

test('a CV that quotes {{ .Values.x }} still builds', () => {
  const quote = 'Tuned the chart with {{ .Values.x }} overrides.';
  const res = run(payload({
    summary: quote,
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: [quote] }],
  }));
  assert.equal(res.status, 0, describeSpawn(res, 'a CV quoting {{ .Values.x }} must still build'));
  assert.match(res.html, /Tuned the chart with &#123;&#123; \.Values\.x &#125;&#125; overrides\./);
  assert.match(res.html, /Test Candidate/);
});
