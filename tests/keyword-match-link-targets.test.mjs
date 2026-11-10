// tests/keyword-match-link-targets.test.mjs — keyword-match reads a markdown
// CV's link text, not its link targets, the way it already reads an HTML CV.
//
// htmlToText() drops an HTML CV's hrefs, but a markdown CV was read raw, so
// "[infrastructure modules](https://github.com/jane/terraform-modules)" made
// Terraform "present" in cv.md and "missing" in the same CV as HTML: 100%
// coverage against 50% for one CV. verify-cv-facts.mjs already reads link text
// only (#6606); the same collapseMarkdownLinks() now runs here.
//
// Run:  node --test tests/keyword-match-link-targets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'keyword-match.mjs');

const JD = [
  'Senior Platform Engineer at Acme',
  '',
  'You will own the infrastructure that runs our payments platform, from provisioning to',
  'deployment, working with a small team of engineers across three time zones.',
  '',
  'Requirements:',
  '- Terraform',
  '- Go',
].join('\n');

function coverage(t, files, cvName) {
  const dir = mkdtempSync(join(tmpdir(), 'co-keyword-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'jd.txt'), JD);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const r = spawnSync(process.execPath, [CLI, '--jd-text', join(dir, 'jd.txt'), '--cv', join(dir, cvName), '--json'], {
    cwd: dir, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const LINKED_MD = '## Experience\n- Wrote the [infrastructure modules](https://github.com/jane/terraform-modules) the team still uses.\n\n## Skills\nGo, Docker\n';
const LINKED_HTML = '<h2>Experience</h2><ul><li>Wrote the <a href="https://github.com/jane/terraform-modules">infrastructure modules</a> the team still uses.</li></ul><h2>Skills</h2><p>Go, Docker</p>';

test('a keyword only in a markdown link target is missing, as it is in the same CV as HTML', (t) => {
  const md = coverage(t, { 'cv.md': LINKED_MD }, 'cv.md');
  const html = coverage(t, { 'cv.html': LINKED_HTML }, 'cv.html');
  assert.deepEqual(md.missing, ['Terraform']);
  assert.deepEqual({ present: md.present, missing: md.missing }, { present: html.present, missing: html.missing });
});

test('a keyword only in a reference link definition is missing', (t) => {
  const r = coverage(t, {
    'cv.md': '## Experience\n- Wrote the [infrastructure modules][tf] the team still uses.\n\n[tf]: https://github.com/jane/terraform-modules\n\n## Skills\nGo, Docker\n',
  }, 'cv.md');
  assert.deepEqual(r.missing, ['Terraform']);
});

test('a keyword in the link text is present', (t) => {
  const r = coverage(t, {
    'cv.md': '## Experience\n- Wrote the [Terraform modules](https://github.com/jane/infra) the team still uses.\n\n## Skills\nGo, Docker\n',
  }, 'cv.md');
  assert.deepEqual(r.missing, []);
});

// CommonMark also lets a definition put its target on the line after the label.
test('a keyword only in a reference definition whose target is on the next line is missing', (t) => {
  const r = coverage(t, {
    'cv.md': '## Experience\n- Wrote the [infrastructure modules][tf] the team still uses.\n\n[tf]:\n  https://github.com/jane/terraform-modules\n\n## Skills\nGo, Docker\n',
  }, 'cv.md');
  assert.deepEqual(r.missing, ['Terraform']);
});

// That form needs the label at the start of its line. A bracketed word that
// ends a line of prose is not a definition, and the line after it is visible.
test('the line after a bracketed word ending a line of prose is still read', (t) => {
  const r = coverage(t, {
    'cv.md': '## Experience\n- Ran the payments platform.\n\n## Skills\nInfrastructure [daily]:\nTerraform\n\nLanguages: Go, Docker\n',
  }, 'cv.md');
  assert.deepEqual(r.missing, []);
});

// Only a real definition is dropped. CommonMark reads a target in angle
// brackets with a space in it as one target, a title as never crossing a blank
// line, and a `[label]:` line inside a paragraph as text.
for (const [label, md, missing] of [
  ['a target in angle brackets holding a space, on the next line', '[tf]:\n  <./Terraform portfolio.pdf>', ['Terraform']],
  ['a target in angle brackets holding a space, on the label line', '[tf]: <./Terraform portfolio.pdf> "Portfolio"', ['Terraform']],
  ['a title wrapped onto a second line', '[tf]: https://example.com/infra\n"Terraform\nmodules"', ['Terraform']],
  ['quoted text that crosses a blank line is no title', '[tf]: https://example.com/infra\n"Wrote the Terraform modules\n\nthe team still uses"', []],
  ['a [label]: line inside a paragraph', 'Infrastructure as code, mostly\n[daily]:\nTerraform', []],
  ['a [label]: in the middle of a line', 'Infrastructure [daily]: Terraform', []],
]) {
  test(`reference definitions: ${label}`, (t) => {
    const r = coverage(t, {
      'cv.md': `## Experience\n- Wrote the [infrastructure modules][tf] the team still uses.\n\n${md}\n\n## Skills\nGo, Docker\n`,
    }, 'cv.md');
    assert.deepEqual(r.missing, missing);
  });
}
