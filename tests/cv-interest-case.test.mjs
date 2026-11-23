// The second interest is lowercased so a sentence reads naturally.
// "Hiking, Chess" becomes "Hiking, chess". "Hiking, AWS" must stay "Hiking, AWS".
//
// Run: node --test tests/cv-interest-case.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function render(interests) {
  const dir = mkdtempSync(join(tmpdir(), 'co-interests-'));
  const input = join(dir, 'cv.json');
  const htmlOut = join(dir, 'cv.html');
  const mdOut = join(dir, 'cv.md');
  writeFileSync(input, JSON.stringify({
    candidate: { name: 'Alex Rivera', location: 'Springfield, IL' },
    interests,
  }));
  const html = spawnSync(process.execPath, ['build-cv-html.mjs', input, htmlOut], { cwd: ROOT, encoding: 'utf8' });
  const md = spawnSync(process.execPath, ['build-cv-html.mjs', input, '--markdown', mdOut], { cwd: ROOT, encoding: 'utf8' });
  const page = html.status === 0 ? readFileSync(htmlOut, 'utf8') : '';
  const review = md.status === 0 ? readFileSync(mdOut, 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { html, md, page, review };
}

test('an acronym interest keeps its capitals on the HTML CV and the markdown review', () => {
  const { html, md, page, review } = render(['Hiking', 'AWS']);
  assert.equal(html.status, 0, html.stderr);
  assert.equal(md.status, 0, md.stderr);
  assert.match(page, /Hiking, AWS/);
  assert.doesNotMatch(page, /aWS/);
  assert.match(review, /Hiking, AWS/);
  assert.doesNotMatch(review, /aWS/);
});

test('a normal second interest is still sentence-cased', () => {
  const { html, page, review } = render(['Hiking', 'Chess']);
  assert.equal(html.status, 0, html.stderr);
  assert.match(page, /Hiking, chess/);
  assert.match(review, /Hiking, chess/);
});
