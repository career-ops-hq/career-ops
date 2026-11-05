// tests/cv-unresolved-placeholders.test.mjs — custom CV templates containing
// unmapped {{...}} tokens must fail the build with "Unresolved placeholders",
// while candidate text containing double braces must stay literal (#6396).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, replaceBalancedTokens } from '../build-cv-html.mjs';

const payload = () => ({
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Jane Doe', email: 'jane@example.com' },
  summary: 'Experienced backend engineer.',
  competencies: ['Cloud Architecture'],
  experience: [{ company: 'Acme Corp', role: 'Engineer', dates: '2024', bullets: ['Built distributed pipelines'] }],
  projects: [], education: [], certifications: [], awards: [],
  skills: [{ category: 'Languages', items: ['TypeScript', 'Go'] }],
});

// #6396: the CV pass used to match only {{UPPER_SNAKE}}, so any other token shape
// was never visited: not filled, not reported, and shipped verbatim in the PDF.
for (const token of [
  '{{role_title}}', '{{OPENING2}}', '{{ COMPANY }}', '{{Name}}', '{{PROFILE-INTRO}}', '{{}}',
  // Brace-bearing expressions: a [^{}] class never matched these.
  '{{ config | default({}) }}', '{{ items.map(i => ({ id: i })) }}',
  // Nested tokens are reported whole, not cut at the inner }}.
  '{{ outer {{ inner }} }}',
]) {
  test(`throws on the non-UPPER_SNAKE token ${token}`, () => {
    const tpl = `<div class="cv"><h1>{{NAME}}</h1><p>${token}</p></div>`;
    assert.throws(
      () => renderHtml(tpl, payload()),
      (err) => err.message.startsWith('Unresolved placeholders:') && err.message.includes(token),
    );
  });
}

test('a space-padded known token is not silently treated as the known token', () => {
  // Lookup stays exact: {{ NAME }} is a typo to report, not {{NAME}}.
  const tpl = '<div class="cv"><h1>{{ NAME }}</h1></div>';
  assert.throws(
    () => renderHtml(tpl, payload()),
    /Unresolved placeholders: \{\{ NAME \}\}/,
  );
});

test('a CV whose own content quotes {{ .Values.x }} still builds', () => {
  const p = payload();
  p.summary = 'Senior engineer writing Helm charts quoting {{ .Values.x }} in templates.';
  p.experience[0].bullets = ['Maintained {{ .Values.service.port }} configurations'];
  const tpl = '<div class="cv"><h1>{{NAME}}</h1><p class="summary">{{SUMMARY_TEXT}}</p><div class="exp">{{EXPERIENCE}}</div></div>';
  const html = renderHtml(tpl, p);
  assert.ok(html.includes('Jane Doe'), 'name should be filled');
  // escapeHtml encodes braces in content, preserving the user text
  assert.ok(
    html.includes('{{ .Values.x }}') || html.includes('&#123;&#123; .Values.x &#125;&#125;'),
    'user content with {{ .Values.x }} must be present in output',
  );
  assert.ok(
    html.includes('{{ .Values.service.port }}') || html.includes('&#123;&#123; .Values.service.port &#125;&#125;'),
    'user content in bullets must be present in output',
  );
  assert.doesNotMatch(html, /Unresolved placeholders/);
});

test('a nested token is reported as one token, with no stray }} left over', () => {
  const tpl = '<div class="cv"><h1>{{NAME}}</h1><p>{{ outer {{ inner }} }}</p></div>';
  assert.throws(() => renderHtml(tpl, payload()), (err) => {
    assert.equal(err.message, 'Unresolved placeholders: {{ outer {{ inner }} }}');
    return true;
  });
});

test('an unterminated {{ does not stop later tokens from being filled or reported', () => {
  // A scanner that gave up at the first unclosed {{ would leave {{NAME}}
  // unfilled and {{UNKNOWN_TOKEN}} unreported.
  const ok = renderHtml('<p>stray {{ here</p><p>{{NAME}}</p>', payload());
  assert.ok(ok.includes('stray {{ here') && ok.includes('Jane Doe'));
  assert.throws(
    () => renderHtml('<p>stray {{ here</p><p>{{UNKNOWN_TOKEN}}</p>', payload()),
    /Unresolved placeholders: \{\{UNKNOWN_TOKEN\}\}/,
  );
});

test('replaceBalancedTokens: spans, depth and literal output', () => {
  const seen = [];
  const out = replaceBalancedTokens('a {{X}} b {{ f({}) }} c {{ o {{ i }} }} d {{ open', (t) => {
    seen.push(t);
    return `<${seen.length}>`;
  });
  assert.deepEqual(seen, ['{{X}}', '{{ f({}) }}', '{{ o {{ i }} }}']);
  assert.equal(out, 'a <1> b <2> c <3> d {{ open');
  // Replacement values are never re-scanned.
  assert.equal(replaceBalancedTokens('{{A}}', () => '{{B}}'), '{{B}}');
});
