// tests/providers/linear-tag-strip.test.mjs — no provider strips tags in
// quadratic time.
//
// A generic tag strip whose body class can match `<`, such as `/<[^>]*>/g` or
// `/<[^>]+>/g`, is quadratic on text with many `<` and no closing `>`: each
// opener scans to the end of the input before it fails, then the next opener
// does the same. A 50,000-character run of `<` takes over a second and a 1 MiB
// one minutes, during a scan, on text a posting supplies. #7289 fixed this in
// providers/_html-to-text.mjs by keeping `<` out of the tag body (`[^<>]`), and
// #7186 in the himalayas posting reader. An unquoted `<` never occurs inside a
// real tag, so excluding it changes nothing for well-formed markup.
//
// This guard keeps the shape out of every provider, and times two of the
// strippers it covers: hackernews.mjs's, which reads comment HTML, and
// _html-to-text.mjs's visibleText(), which #7289 left on the old shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHnComment } from '../../providers/hackernews.mjs';
import { visibleText } from '../../providers/_html-to-text.mjs';

const PROVIDERS = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'providers');

/** Source with block and line comments blanked, so prose about the pattern is not flagged. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

test('no provider strips tags with a body class that can match "<"', () => {
  const offenders = [];
  for (const name of readdirSync(PROVIDERS).filter((f) => f.endsWith('.mjs')).sort()) {
    const lines = code(readFileSync(join(PROVIDERS, name), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/<\[\^>\][*+]>/.test(line)) offenders.push(`providers/${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `use <[^<>]*> or <[^<>]+> so an unclosed "<" cannot make the strip quadratic:\n${offenders.join('\n')}`);
});

test('a Hacker News comment or a fragment of unclosed "<" is stripped in linear time', () => {
  const hostile = '<'.repeat(100_000);
  for (const [name, strip] of [['parseHnComment', parseHnComment], ['visibleText', visibleText]]) {
    const started = performance.now();
    strip(hostile);
    const elapsed = performance.now() - started;
    // Quadratic, this took seconds on a laptop; linear, it takes milliseconds.
    assert.ok(elapsed < 1500, `${name} took ${Math.round(elapsed)} ms on 100,000 unclosed "<"`);
  }
});

test('well-formed markup strips as before', () => {
  assert.deepEqual(
    parseHnComment('<p>Acme | Platform Engineer | Remote | <a href="https://acme.example/jobs/1">apply</a></p><p>We build <b>reliable</b> software &amp; tools.</p>'),
    { title: 'Acme | Platform Engineer | Remote |', url: 'https://acme.example/jobs/1', company: 'Acme', location: 'Remote' },
  );
  assert.equal(visibleText('<span class="t">Senior <b>Data</b> Engineer</span><!-- x -->'), 'Senior Data Engineer');
});
