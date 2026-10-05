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
// Section partials are in scope too. `templates/sections/*.html` are fragments
// composed INTO these templates, and a rendered CV carries whatever they hold.
// Measured before adding them: a `<span style="display:none">` planted inside
// experience.html's ENTRY zone reached the rendered HTML, and this sweep stayed
// at 11 pass / 0 fail. That is the stuffing trick no-hidden-text exists to
// catch, shipping through the one file the sweep did not read.
// They are linted whole. Everything outside the ENTRY zone is HTML comments
// today, in all ten of them, and stripNonContent drops comments anyway.
//
// Second known gap, about what this sweep is worth per rule. Every heading in
// every shipped template is a bare `{{SECTION_*}}` placeholder, so
// standard-section-headers has nothing literal to judge and passes each file
// vacuously. It runs on all of them now, which is what the skip fix bought.
// Its findings on a shipped template stay empty for a reason this sweep cannot
// distinguish from a real pass. The rule earns its keep on a user's own
// template or a third-party pack, where a literal `Career Timeline` heading
// does reach it. nested-table and hidden-text are checked here for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsLint, listTemplates } from '../cv-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const templates = [
  ...listTemplates('cv').map((t) => ({ path: t.path, kind: 'cv' })),
  ...listTemplates('cover').map((t) => ({ path: t.path, kind: 'cover' })),
  { path: join(ROOT, 'templates', 'resume-template.html'), kind: 'cv' },
].filter((t) => existsSync(t.path));

// Derived the way build-cv-html.mjs resolves them, from a sections/ directory
// co-located with each template, so a pack that ships its own is swept the day
// it lands and nobody has to remember this file.
const partials = [...new Set(templates.map((t) => join(dirname(t.path), 'sections')))]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ path: join(dir, f), kind: 'cv', partial: true })));

const shipped = [...templates, ...partials];

test('the sweep actually has templates to sweep', () => {
  // Without this, a resolver change that returns nothing turns every assertion
  // below into a loop over an empty list — green, and checking nothing.
  assert.ok(shipped.length >= 8, `expected the shipped template set, found ${shipped.length}`);
  const names = shipped.map((t) => relative(ROOT, t.path));
  assert.ok(names.includes(join('templates', 'cv-template.html')), 'the default CV template must be in the sweep');
  assert.ok(names.includes(join('templates', 'cover-letter-template.html')), 'the cover-letter template must be in the sweep');

  // The partial set has its own floor. Without it a rename of sections/ leaves
  // the templates asserted and the fragments silently unswept, which is the
  // state this suite was in before they were added.
  assert.ok(partials.length >= 7, `expected the shipped section partials, found ${partials.length}`);
  assert.ok(names.includes(join('templates', 'sections', 'experience.html')), 'the experience partial must be in the sweep');
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
