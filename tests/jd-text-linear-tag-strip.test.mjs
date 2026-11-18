// tests/jd-text-linear-tag-strip.test.mjs — the scripts that strip posting
// text or a fetched page do it in linear time.
//
// A generic tag strip whose body class can match `<` (`/<[^>]*>/g`,
// `/<[^>]+>/g`) is quadratic on text with many `<` and no closing `>`: each
// opener scans to the end of the input before it fails. 40,000 unclosed `<`
// took about half a second in each helper below, and the time grows with the
// square of the length. #7289 fixed providers/_html-to-text.mjs by keeping `<`
// out of the tag body (`[^<>]`); these seven files read the same kind of text:
// a posting's description, an evaluated report's JD, or a fetched job page.
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

test('no generic tag strip in these files has a body class that can match "<"', () => {
  const offenders = [];
  for (const file of FILES) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      if (/<\[\^>\][*+]>/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `use <[^<>]*> or <[^<>]+> so an unclosed "<" cannot make the strip quadratic:\n${offenders.join('\n')}`);
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

test('well-formed markup strips as before', () => {
  const html = '<div class="jd"><h2>Platform Engineer</h2><p>Build <b>reliable</b> APIs &amp; tools.</p><ul><li>Node.js</li><li>Postgres</li></ul></div>';
  assert.equal(normalizeJdText(html), 'platform engineer build reliable apis tools node js postgres');
  assert.equal(keywordMatchText(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(decodeHtml(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(flattenHtml(html), 'Platform Engineer Build reliable APIs & tools. Node.js Postgres');
  assert.equal(apifyText(html), 'Platform EngineerBuild reliable APIs & tools.\n\n- Node.js\n- Postgres');
});
