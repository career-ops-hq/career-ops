// tests/cv-template-edu-break-chain.test.mjs — no shipped CV template puts
// `.edu-location` in a `break-after: avoid` rule.
//
// `.edu-location` is the last line of an `.edu-item`, which is already
// `break-inside: avoid`. Adding `break-after: avoid` to that last line forbids
// the break between the item and whatever follows it. When Education is
// followed by a section title (itself `break-after: avoid`) and more
// unbreakable items, the forbidden breaks chain: Education, Certifications and
// Skills become one unit and move to the next page together, leaving a blank
// band at the bottom of the previous page whenever an education entry has a
// location. Measured with the default template and a fictional payload: about
// 93pt free at the bottom of page 1, Education needing about 50pt, and all
// three sections rendered on page 2. Without the rule, Education stays on
// page 1 and only the sections that do not fit move.
//
// A heading-to-content rule like the one this list exists for still holds for
// Education: the item cannot split, so its title is never stranded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'templates');

const shipped = readdirSync(TEMPLATES)
  .filter((f) => /^(cv-template(\.[\w-]+)?|resume-template)\.html$/.test(f));

// Every CSS rule in the file's <style> blocks as { selectors, body }.
function cssRules(html) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2],
  }));
}

test('the shipped template set is discovered', () => {
  assert.ok(shipped.includes('cv-template.html'), `templates found: ${shipped.join(', ')}`);
  assert.ok(shipped.length > 1, `templates found: ${shipped.join(', ')}`);
});

for (const file of shipped) {
  test(`${file}: .edu-location is not in a break-after: avoid rule`, () => {
    const offending = cssRules(readFileSync(join(TEMPLATES, file), 'utf8'))
      .filter((r) => /(?:^|;)\s*(?:page-)?break-after\s*:\s*avoid\b/i.test(r.body))
      .filter((r) => r.selectors.includes('.edu-location'));
    assert.deepEqual(offending.map((r) => r.selectors.join(', ')), []);
  });
}
