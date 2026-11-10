// tests/cover-unresolved-placeholders.test.mjs — buildHtml must not ship a
// literal {{TOKEN}} into a rendered cover letter.
//
// build-cv-html.mjs throws on unresolved placeholders and build-cv-latex.mjs
// exits 1; generate-cover-letter.mjs left them untouched, so a custom
// cover-letter template (KINDS.cover) carrying a typo'd or unsupported token
// rendered that token verbatim into the PDF. Silent, and only visible to
// whoever reads the letter afterwards — which may be the employer.
//
// The second test is the one that matters for the fix's shape: the single-pass
// substitution deliberately leaves a {{TOKEN}} sequence *inside a substituted
// value* literal, so the guard has to distinguish an unfilled template token
// from user text that merely looks like one. A post-hoc scan of the output
// cannot, which is why detection happens during the pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml, replaceBalancedTokens } from '../generate-cover-letter.mjs';

const writeTemplate = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'cover-placeholder-'));
  const path = join(dir, 'cover-letter-template.html');
  writeFileSync(path, `<html><body>${body}</body></html>`);
  return path;
};

const payload = () => ({
  candidate: { name: 'Jane Doe', email: 'jane@example.test' },
  letter: {
    role_title: 'Backend Engineer',
    opening: 'I am applying for this role.',
    profile_intro: 'Five years of backend work.',
  },
});

test('throws on a template token the renderer cannot fill', () => {
  const tpl = writeTemplate('<p>{{OPENING}}</p><p>Dear team at {{COMPANY}},</p>');
  assert.throws(
    () => buildHtml(payload(), tpl),
    /Unresolved placeholders: \{\{COMPANY\}\}/,
    'a custom template with an unsupported token must fail loudly, not render it verbatim',
  );
});

test('a {{TOKEN}} inside a substituted value stays literal and is not flagged', () => {
  // The single-pass substitution guarantees this text is not re-interpreted as
  // a placeholder. It must also not be mistaken for an unfilled one.
  const p = payload();
  p.letter.opening = 'My last team called the config {{PLACEHOLDER}} for short.';
  const tpl = writeTemplate('<p>{{OPENING}}</p>');
  const html = buildHtml(p, tpl);
  assert.match(html, /\{\{PLACEHOLDER\}\}/, 'user text containing a token sequence survives verbatim');
});

test('reports every unresolved token, not just the first', () => {
  const tpl = writeTemplate('<p>{{COMPANY}}</p><p>{{HIRING_MANAGER}}</p><p>{{OPENING}}</p>');
  assert.throws(() => buildHtml(payload(), tpl), (err) => {
    assert.match(err.message, /\{\{COMPANY\}\}/);
    assert.match(err.message, /\{\{HIRING_MANAGER\}\}/);
    return true;
  });
});

test('the shipped template still renders clean', () => {
  // Guards the fix itself: if the bundled template ever gains a token the
  // renderer does not map, this fails instead of every user's render failing.
  const html = buildHtml(payload(), 'templates/cover-letter-template.html');
  assert.doesNotMatch(html, /\{\{[\s\S]*?\}\}/, 'bundled template must be fully mapped');
  assert.match(html, /Jane Doe/);
});

// #6374: the pass used to match only {{UPPER_SNAKE}}, so any other token shape
// was never visited: not filled, not reported, shipped verbatim in the PDF.
for (const token of [
  '{{role_title}}', '{{OPENING2}}', '{{ COMPANY }}', '{{Name}}', '{{PROFILE-INTRO}}', '{{}}',
  // Brace-bearing expressions (CodeRabbit on #6382): a [^{}] class never matched these.
  '{{ config | default({}) }}', '{{ items.map(i => ({ id: i })) }}',
  // Nested tokens are reported whole (CodeRabbit on #6382), not cut at the inner }}.
  '{{ outer {{ inner }} }}',
]) {
  test(`throws on the non-UPPER_SNAKE token ${token}`, () => {
    const tpl = writeTemplate(`<p>{{OPENING}}</p><p>${token}</p>`);
    assert.throws(
      () => buildHtml(payload(), tpl),
      (err) => err.message.startsWith('Unresolved placeholders:') && err.message.includes(token),
    );
  });
}

test('a space-padded known token is not silently treated as the known token', () => {
  // Lookup stays exact: {{ OPENING }} is a typo to report, not {{OPENING}}.
  const tpl = writeTemplate('<p>{{ OPENING }}</p>');
  assert.throws(() => buildHtml(payload(), tpl), /Unresolved placeholders: \{\{ OPENING \}\}/);
});

test('user text shaped like a non-UPPER_SNAKE token stays literal and is not flagged', () => {
  const p = payload();
  p.letter.opening = 'I maintain the {{role_title}} and {{ company }} Jinja macros.';
  const html = buildHtml(p, writeTemplate('<p>{{OPENING}}</p>'));
  assert.ok(html.includes('{{role_title}}') && html.includes('{{ company }}'));
});

test('a nested token is reported as one token, with no stray }} left over', () => {
  const tpl = writeTemplate('<p>{{OPENING}}</p><p>{{ outer {{ inner }} }}</p>');
  assert.throws(() => buildHtml(payload(), tpl), (err) => {
    assert.equal(err.message, 'Unresolved placeholders: {{ outer {{ inner }} }}');
    return true;
  });
});

test('an unterminated {{ does not stop later tokens from being filled or reported', () => {
  // A scanner that gave up at the first unclosed {{ would leave {{OPENING}}
  // unfilled and {{COMPANY}} unreported.
  const ok = buildHtml(payload(), writeTemplate('<p>stray {{ here</p><p>{{OPENING}}</p>'));
  assert.ok(ok.includes('stray {{ here') && ok.includes('I am applying for this role.'));
  assert.throws(
    () => buildHtml(payload(), writeTemplate('<p>stray {{ here</p><p>{{COMPANY}}</p>')),
    /Unresolved placeholders: \{\{COMPANY\}\}/,
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
