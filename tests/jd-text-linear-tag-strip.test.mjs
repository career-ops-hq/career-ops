// tests/jd-text-linear-tag-strip.test.mjs — the scripts that strip posting
// text or a fetched page do it in linear time.
//
// A generic tag strip (`/<[^>]*>/g`, `/<[^>]+>/g`) is quadratic on text with
// many `<` and no closing `>`: each opener scans to the end of the input
// before it fails. 40,000 unclosed `<` took about half a second in each helper
// below, and the time grows with the square of the length. These seven files
// read a posting's description, an evaluated report's JD, or a fetched job
// page.
//
// They now match `/<[^>]*(>?)/g` (or `/<([^>]*)(>?)/g` for the `+` form) and
// replace a match only when it closed. A run that never closes is consumed
// once and handed back unchanged, so the later `<` in it are never tried
// again; every other match is the one the old pattern made, so the output is
// the same as before on every input. Keeping `<` out of the tag body (`[^<>]`)
// is also linear, but it changes the output when an attribute value holds a
// `<`, and it made apify's strip-until-nothing-changes loop quadratic on
// nested `<a<a…>>` instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeJdText } from '../fingerprint-core.mjs';
import { htmlToText as keywordMatchText } from '../keyword-match.mjs';
import { decodeHtml } from '../scan-local-lib.mjs';
import { flattenHtml } from '../harvest-buildlist.mjs';
import { htmlToText as apifyText } from '../plugins/apify/index.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILES = [
  'fingerprint-core.mjs', 'keyword-match.mjs', 'scan-local-lib.mjs', 'harvest-buildlist.mjs',
  'plugins/apify/index.mjs', 'lib/jd-page-fetch.mjs', 'openrouter-runner.mjs',
];
const STRIPPERS = [
  ['fingerprint-core normalizeJdText', normalizeJdText],
  ['keyword-match htmlToText', keywordMatchText],
  ['scan-local-lib decodeHtml', decodeHtml],
  ['harvest-buildlist flattenHtml', flattenHtml],
  ['apify htmlToText', apifyText],
];

test('no generic tag strip in these files has the quadratic <[^>]*> or <[^>]+> shape', () => {
  const offenders = [];
  for (const file of FILES) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      if (/<\[\^>\][*+]>/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [],
    `replace /<[^>]*(>?)/g with (tag, close) => (close ? r : tag), so an unclosed "<" cannot make the strip quadratic:\n${offenders.join('\n')}`);
});

test('each helper strips 100,000 unclosed "<" in linear time', () => {
  const hostile = '<'.repeat(100_000);
  for (const [name, strip] of STRIPPERS) {
    const started = performance.now();
    strip(hostile);
    const elapsed = performance.now() - started;
    // Quadratic, each took seconds on a laptop; linear, milliseconds.
    assert.ok(elapsed < 1500, `${name} took ${Math.round(elapsed)} ms on 100,000 unclosed "<"`);
  }
});

test("apify's strip-until-nothing-changes loop stays linear on nested \"<a…>\"", () => {
  const nested = `${'<a'.repeat(50_000)}${'>'.repeat(50_000)}`;
  const started = performance.now();
  const out = apifyText(nested);
  const elapsed = performance.now() - started;
  // One pass per level of nesting took 3.7 s here; the loop now ends after two.
  assert.ok(elapsed < 1500, `apify htmlToText took ${Math.round(elapsed)} ms on 50,000 nested "<a"`);
  // As before: the first pass removes everything up to the first ">".
  assert.equal(out, '>'.repeat(49_999));
});

test('malformed markup strips as before: a "<" inside a tag is part of the tag', () => {
  const inputs = ['<a title="x<y">Platform</a> Engineer', 'Data <b<i>x> Engineer', 'a <> b', 'Go <<b>and> Rust'];
  const sameAsBefore = ['Platform Engineer', 'Data x> Engineer', 'a <> b', 'Go and> Rust'];
  assert.deepEqual(inputs.map(normalizeJdText), ['platform engineer', 'data x engineer', 'a b', 'go and rust']);
  for (const [name, strip] of STRIPPERS.slice(1)) assert.deepEqual(inputs.map(strip), sameAsBefore, name);
});

test('well-formed markup strips as before', () => {
  const html = '<div class="jd"><h2>Platform Engineer</h2><p>Build <b>reliable</b> APIs &amp; tools.</p><ul><li>Node.js</li><li>Postgres</li></ul></div>';
  assert.equal(normalizeJdText(html), 'platform engineer build reliable apis tools node js postgres');
  assert.equal(keywordMatchText(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(decodeHtml(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(flattenHtml(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(apifyText(html), 'Platform EngineerBuild reliable APIs & tools.\n\n- Node.js\n- Postgres');
});
