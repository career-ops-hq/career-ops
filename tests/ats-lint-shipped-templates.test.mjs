// tests/ats-lint-shipped-templates.test.mjs — atsLint runs on the templates
// this project ships, on every PR (#3109).
//
// This is the CI half of the lint, and it is the point of the exercise: a rule
// the project's own templates violate is a rule the project does not actually
// hold. Discovering that here is cheap; discovering it after a user's CV has
// been parsed badly is not.
//
// It runs under test-all.mjs, which .github/workflows/test.yml executes on
// every pull request across three operating systems. No workflow step of its
// own — a discovered suite is how this repo gates things.
//
// Scope is the templates the project ships as HTML: everything the resolver
// discovers (flat files and template packs, both kinds), plus resume-template.
// html, which predates the `cv-template.<name>.html` convention and so is
// invisible to discovery while still being a shipped template reachable via
// `generate-pdf.mjs --template`.
//
// Known gap, stated rather than hidden: `templates/sections/*.html` are
// fragments composed INTO these templates, not templates themselves, and
// atsLint's signature is (path, kind). A nested table introduced in a partial
// would reach a rendered CV without passing through here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsLint, listTemplates } from '../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shipped = [
  ...listTemplates('cv').map((t) => ({ path: t.path, kind: 'cv' })),
  ...listTemplates('cover').map((t) => ({ path: t.path, kind: 'cover' })),
  { path: join(ROOT, 'templates', 'resume-template.html'), kind: 'cv' },
].filter((t) => existsSync(t.path));

test('the sweep actually has templates to sweep', () => {
  // Without this, a resolver change that returns nothing turns every assertion
  // below into a loop over an empty list — green, and checking nothing.
  assert.ok(shipped.length >= 8, `expected the shipped template set, found ${shipped.length}`);
  const names = shipped.map((t) => relative(ROOT, t.path));
  assert.ok(names.includes(join('templates', 'cv-template.html')), 'the default CV template must be in the sweep');
  assert.ok(names.includes(join('templates', 'cover-letter-template.html')), 'the cover-letter template must be in the sweep');
});

for (const { path, kind } of shipped) {
  const rel = relative(ROOT, path);
  test(`atsLint: ${rel} (${kind})`, () => {
    const result = atsLint(path, kind);
    assert.equal(result.error, null, `${rel}: atsLint could not read it — ${result.error}`);
    // A detector that silently stopped being dispatched would make this pass
    // for the wrong reason, so assert the lint actually ran some rules.
    assert.ok(
      result.findings.length + result.skipped.length > 0,
      `${rel}: no rule was evaluated at all — the rules file or the detector map is empty`
    );
    assert.deepEqual(
      result.findings,
      [],
      `${rel} violates a rule the project documents in modes/pdf.md:\n`
        + result.findings.map((f) => `  [${f.severity}] ${f.id}: ${f.detail}`).join('\n')
        + '\n\nFix the template, or — if the rule is wrong — change it in templates/ats-rules.yml '
        + 'and in modes/pdf.md together. Do not silence it in the detector.'
    );
  });
}
