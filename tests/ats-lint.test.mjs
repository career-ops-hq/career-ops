import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsLint, loadAtsRules } from '../cv-templates.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ats-lint-'));
const rules = loadAtsRules();
const byId = new Map(rules.map((r) => [r.id, r]));

/** Write a template fixture and lint it. */
function lint(html, kind = 'cv') {
  const p = join(dir, `t-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(p, html);
  return atsLint(p, kind);
}

const ids = (r) => r.findings.map((f) => f.id);

// A template that is clean under every template-applicable rule. Every negative
// case below is this document plus exactly one violation, so a rule that fires
// here would make every negative case vacuous.
const CLEAN = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>body{font-family:Georgia,serif}</style></head><body>
<h1>{{NAME}}</h1><p>{{EMAIL}}</p>
<h2>Professional Summary</h2><p>{{SUMMARY}}</p>
<h2>Work Experience</h2><ul><li>{{EXPERIENCE}}</li></ul>
<h2>Education</h2><p>{{EDUCATION}}</p>
<h2>Skills</h2><p>{{SKILLS}}</p>
</body></html>`;

test('the clean fixture raises nothing, so every negative case below is meaningful', () => {
  const r = lint(CLEAN);
  assert.deepEqual(r.findings, [], `clean fixture raised: ${JSON.stringify(r.findings)}`);
});

// ── The contract and the code cannot drift ──────────────────────────────
// This is the test that earns templates/ats-rules.yml. Without it the YAML is
// documentation, and documentation drifts silently.

test('every rule with a detector has a matching id in verify-ats.mjs', () => {
  const src = readFileSync(join(ROOT, 'verify-ats.mjs'), 'utf-8');
  const inCode = new Set([...src.matchAll(/\badd\('([a-z0-9-]+)'/g)].map((m) => m[1]));
  assert.ok(inCode.size > 0, 'found no add() ids in verify-ats.mjs — the extraction is wrong, not the code');
  for (const r of rules.filter((x) => x.detect)) {
    assert.ok(inCode.has(r.id), `ats-rules.yml declares "${r.id}" with a detector, but verify-ats.mjs raises no such id`);
  }
});

test('every id verify-ats.mjs raises is declared in ats-rules.yml', () => {
  const src = readFileSync(join(ROOT, 'verify-ats.mjs'), 'utf-8');
  for (const m of src.matchAll(/\badd\('([a-z0-9-]+)'/g)) {
    assert.ok(byId.has(m[1]), `verify-ats.mjs raises "${m[1]}", which ats-rules.yml does not declare`);
  }
});

test('every rule states what it must not flag, or why it has no detector', () => {
  for (const r of rules) {
    const has = (r.must_not_flag && r.must_not_flag.trim()) || (r.open && r.open.trim());
    assert.ok(has, `rule "${r.id}" states neither must_not_flag nor open`);
  }
});

test('every rendered-only rule says why it is not meaningful on a template', () => {
  for (const r of rules.filter((x) => !x.applies_to.includes('template'))) {
    assert.ok(r.not_template_reason && r.not_template_reason.trim(),
      `rule "${r.id}" is rendered-only but does not say why`);
  }
});

// ── The measured false positive this whole file exists to prevent ───────

test('a template is not failed for carrying {{EMAIL}} instead of an email', () => {
  const r = lint(CLEAN);
  assert.ok(!ids(r).includes('contact-email-missing'), 'the placeholder was treated as a missing email');
  assert.ok(r.skipped.some((s) => s.id === 'contact-email-missing'),
    'the check was dropped silently rather than reported as skipped');
});

test('a skipped rule carries its reason, so a skip is never mistaken for a pass', () => {
  for (const s of lint(CLEAN).skipped) {
    assert.ok(s.reason && s.reason.trim(), `skipped "${s.id}" with no reason`);
  }
});

// ── Per-rule: fires on a violation, silent on the compliant fixture ─────

const CASES = [
  ['layout-tables', CLEAN.replace('<h1>{{NAME}}</h1>', '<table><tr><td><h1>{{NAME}}</h1></td></tr></table>')],
  ['multi-column', CLEAN.replace('body{font-family:Georgia,serif}', 'body{font-family:Georgia,serif}.x{column-count:2}')],
  ['absolute-positioning', CLEAN.replace('<h1>{{NAME}}</h1>', '<h1 style="position:absolute">{{NAME}}</h1>')],
  ['fonts-nonstandard', CLEAN.replace('Georgia,serif', '"Comic Sans MS",serif')],
  ['charset-missing', CLEAN.replace('<meta charset="utf-8">', '')],
  ['hidden-text', CLEAN.replace('body{font-family:Georgia,serif}', 'body{font-family:Georgia,serif}.k{display:none}')],
  ['section-headings', CLEAN.replace('<h2>Education</h2>', '<h2>Schooling</h2>').replace('<h2>Skills</h2>', '<h2>Things I Do</h2>')],
];

for (const [id, violating] of CASES) {
  test(`${id}: fires on a template that violates it`, () => {
    assert.ok(ids(lint(violating)).includes(id),
      `expected "${id}", got: ${ids(lint(violating)).join(', ') || '(nothing)'}`);
  });

  test(`${id}: stays quiet on the compliant fixture`, () => {
    assert.ok(!ids(lint(CLEAN)).includes(id), `"${id}" fires on a compliant template`);
  });
}

test('every template-applicable rule with a detector has a case above', () => {
  const covered = new Set(CASES.map(([id]) => id));
  for (const r of rules) {
    if (!r.detect || !r.applies_to.includes('template')) continue;
    assert.ok(covered.has(r.id), `rule "${r.id}" is checked on templates but has no test case`);
  }
});

// ── The shipped templates ──────────────────────────────────────────────

test('no shipped template raises a critical finding', () => {
  const files = readdirSync(join(ROOT, 'templates')).filter((f) => f.endsWith('.html'));
  assert.ok(files.length >= 8, `expected the shipped templates, found ${files.length}`);
  for (const f of files) {
    const kind = f.startsWith('cover-letter') ? 'cover' : 'cv';
    const crit = atsLint(join(ROOT, 'templates', f), kind).findings.filter((x) => x.severity === 'critical');
    assert.deepEqual(crit, [], `${f} raises: ${crit.map((c) => c.id).join(', ')}`);
  }
});

test('an image in a template defers to render rather than guessing', () => {
  // Both image rules branch on body-text length, and a template's body is
  // placeholders — so an <img> always routes to the critical image-text-baked,
  // which is rendered-only. The template must be deferred, not passed.
  const r = lint(CLEAN.replace('<h1>{{NAME}}</h1>', '<h1>{{NAME}}</h1><img src="skills.png">'));
  assert.deepEqual(r.findings, [], `image in a template raised: ${JSON.stringify(r.findings)}`);
  assert.ok(r.skipped.some((s) => s.id === 'image-text-baked'),
    'the image was neither flagged nor reported as deferred');
});

test('the CV section enumeration is not applied to a cover letter', () => {
  // Regression: without `kinds`, section-headings raised a CRITICAL on
  // templates/cover-letter-template.html, which has no Experience/Education/
  // Skills headings by design.
  const cover = join(ROOT, 'templates', 'cover-letter-template.html');
  assert.ok(!ids(atsLint(cover, 'cover')).includes('section-headings'));
});

test('a rule scoped to other kinds is not reported as skipped either', () => {
  const r = atsLint(join(ROOT, 'templates', 'cover-letter-template.html'), 'cover');
  assert.ok(!r.skipped.some((s) => s.id === 'section-headings'),
    'a rule that does not apply was reported as deferred');
});

// ── The gaps stay visible ──────────────────────────────────────────────

test('rules with no detector are reported on every run', () => {
  const gaps = lint(CLEAN).gaps.map((g) => g.id);
  for (const r of rules.filter((x) => !x.detect)) {
    assert.ok(gaps.includes(r.id), `gap "${r.id}" is not surfaced to callers`);
  }
  assert.ok(gaps.length > 0, 'a clean run must still report what is not checked');
});

test('the cached contract cannot be mutated out from under a later caller', () => {
  // The default path is cached and returned by reference. Before this was
  // frozen, flipping one rule's applies_to to ['rendered'] made every later
  // atsLint() call in the process report that rule's real violations as
  // "skipped" — the finding vanished and the result still looked well-formed.
  const rule = loadAtsRules().find((r) => r.id === 'layout-tables');
  assert.throws(() => { rule.applies_to = ['rendered']; }, TypeError);
  assert.throws(() => { rule.severity = 'info'; }, TypeError);
  assert.throws(() => { loadAtsRules().push({ id: 'injected' }); }, TypeError);

  // and the contract still behaves
  const violating = CLEAN.replace('<h1>{{NAME}}</h1>', '<table><tr><td><h1>{{NAME}}</h1></td></tr></table>');
  assert.ok(ids(lint(violating)).includes('layout-tables'));
});

test('atsLint rejects an unknown kind rather than linting against nothing', () => {
  assert.throws(() => lint(CLEAN, 'resume'), /Unknown template kind/);
});
