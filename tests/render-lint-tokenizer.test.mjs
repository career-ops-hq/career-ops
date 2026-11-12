// tests/render-lint-tokenizer.test.mjs — the HTML scanner behind renderLint (scanHtml / tagAttributes
// in cv-templates.mjs) and the attribute decoder (providers/_html-entities.mjs) against Chromium's own parse.
//
// Three fixtures hold what Chromium (JavaScript off) made of seeded input, so this test needs no browser:
//   tests/fixtures/render-lint-tags.json      each start tag: the element name, its attributes in order with
//     decoded values, and whether the marker element after the tag was reached. `generated` is the first
//     240 tags of generateTags(240, 7) from tests/render-lint-tag-grammar.mjs, which mixes quotes in unquoted
//     values and names, `=` and `<` in names, missing values, `>` inside quotes, NBSP and the other whitespace,
//     character references, duplicate attributes, unterminated quotes and `/` everywhere. `explicit` is
//     EXPLICIT_TAGS there, led by the case that mis-tokenised before: a quote opens a value only right after
//     `=`, so `alt=Jane's` is one unquoted value.
//   tests/fixtures/render-lint-docs.json      each small document: which tags the tree builder made into
//     elements, with their namespace. `generated` is generateDocs(500, 3) from
//     tests/render-lint-doc-grammar.mjs, which nests html, svg and math with the integration points, the raw
//     text elements, self-closing forms and end tags; `explicit` is EXPLICIT_DOCS there.
//   tests/fixtures/render-lint-entities.json  attribute values made of character references, and what
//     Chromium decodes each to. `generated` is generateEntityValues(1500, 5) from the same file.
//
// To re-record them (they go stale when a grammar changes, and the first test below says so), run, with
// Playwright's Chromium installed:
//   node tests/render-lint-record-fixture.mjs [tags|docs|values|entities|all]
// The same script fuzzes fresh seeds against Chromium and prints the mismatches:
//   node tests/render-lint-record-fixture.mjs fuzz docs 20000 1 --show 5
// It is not a *.test.mjs file, so test-all.mjs never runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanHtml, tagAttributes } from '../cv-templates.mjs';
import { decodeEntities } from '../providers/_html-entities.mjs';
import { generateTags, EXPLICIT_TAGS } from './render-lint-tag-grammar.mjs';
import { generateDocs, generateEntityValues, EXPLICIT_DOCS } from './render-lint-doc-grammar.mjs';

const load = (name) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));
const fixture = load('render-lint-tags.json');
const docs = load('render-lint-docs.json');
const values = load('render-lint-entities.json');

function parsed(html) {
  const { tags } = scanHtml(html);
  const isMarker = (t) => t.name === 'i' && tagAttributes(t.raw).find(([k]) => k === 'id')?.[1] === 'z';
  const first = tags[0] && !isMarker(tags[0]) ? tags[0] : null;
  return {
    name: first ? first.name : null,
    attrs: first ? tagAttributes(first.raw) : [],
    ended: tags.some(isMarker),
  };
}

test('the grammars still produce the recorded inputs for their seeds', () => {
  assert.deepEqual(generateTags(fixture.count, fixture.seed), fixture.generated.map((g) => g.html));
  assert.deepEqual(fixture.explicit.map((e) => e.html), EXPLICIT_TAGS.map((e) => e.html));
  assert.deepEqual(generateDocs(docs.count, docs.seed), docs.generated.map((g) => g.html));
  assert.deepEqual(docs.explicit.map((e) => e.html), EXPLICIT_DOCS.map(([, html]) => html));
  assert.deepEqual(generateEntityValues(values.count, values.seed), values.generated.map((g) => g.value));
});

test('scanHtml reads each generated tag the way Chromium does', () => {
  const wrong = [];
  for (const { html, name, attrs, ended } of fixture.generated) {
    const got = parsed(html);
    if (got.name !== name || got.ended !== ended || JSON.stringify(got.attrs) !== JSON.stringify(attrs)) {
      wrong.push({ html, expected: { name, attrs, ended }, got });
    }
  }
  assert.deepEqual(wrong.slice(0, 3), []);
  assert.equal(wrong.length, 0);
});

for (const { note, html, name, attrs, ended } of fixture.explicit) {
  test(`scanHtml reads: ${note}`, () => {
    const got = parsed(html);
    assert.equal(got.name, name);
    assert.deepEqual(got.attrs, attrs);
    assert.equal(got.ended, ended);
  });
}

test('a start tag the input ends inside is dropped, as the parser drops it', () => {
  assert.deepEqual(scanHtml('<img src="https://example.com/a.png"').tags, []);
  assert.deepEqual(scanHtml('<img src=https://example.com/a.png').tags, []);
  assert.deepEqual(scanHtml('<p>x</p><img alt="a').tags.map((t) => t.name), ['p']);
});

// Each input is timed on its own. A quadratic path on any of them takes minutes,
// while the linear ones together take under a second locally and several on a slow
// Windows runner, so one budget for the whole set measured the runner, not the code.
test('tokenizing is linear: long runs of quotes, equals signs and attributes finish at once', () => {
  const slow = [];
  for (const html of [
    `<x ${'a="b" '.repeat(100000)}>`,
    `<x ${'="'.repeat(100000)}`,
    `<x a=${"'".repeat(200000)}>`,
    `<x ${'a'.repeat(300000)}=b>`,
    '<x a="b"'.repeat(50000),
    `<x ${'/'.repeat(300000)}>`,
    `${'<x a=\''.repeat(20000)}`,
    // The open-element stack: end tags that match nothing, ignored start tags, and a deep stack of each kind.
    `<span>${'</x>'.repeat(100000)}`,
    `${'<b>'.repeat(50000)}${'<form>'.repeat(50000)}`,
    `${'<b>'.repeat(50000)}${'<td>'.repeat(50000)}`,
    `${'<b>'.repeat(50000)}${'<select>'.repeat(50000)}`,
    `${'<svg><g>'.repeat(25000)}${'</x>'.repeat(50000)}`,
    `${'<p>'.repeat(50000)}${'<div>'.repeat(50000)}`,
    `${'<svg><style>'.repeat(20000)}`,
    `<script>${'<!--<script>'.repeat(20000)}`,
  ]) {
    const started = Date.now();
    scanHtml(html);
    const took = Date.now() - started;
    if (took >= 5000) slow.push(`${took} ms: ${html.slice(0, 40)}…`);
  }
  assert.deepEqual(slow, []);
});

// What the tree builder made of each tag, by data-n: [name, namespace]. Chromium names an svg element in
// camelCase (foreignObject); scanHtml lower-cases names.
function elementsOf(html) {
  const out = {};
  for (const t of scanHtml(html).tags) {
    const n = tagAttributes(t.raw).find(([k]) => k === 'data-n')?.[1];
    if (n !== undefined && !(n in out)) out[n] = [t.name, t.ns];
  }
  return out;
}
const lowered = (elements) => Object.fromEntries(Object.entries(elements).map(([n, [name, ns]]) => [n, [name.toLowerCase(), ns]]));

test('scanHtml makes the same elements, in the same namespaces, as Chromium from each generated document', () => {
  const wrong = [];
  for (const { html, elements } of docs.generated) {
    if (JSON.stringify(elementsOf(html)) !== JSON.stringify(lowered(elements))) wrong.push({ html, expected: elements, got: elementsOf(html) });
  }
  assert.deepEqual(wrong.slice(0, 3), []);
  assert.equal(wrong.length, 0);
});

for (const { note, html, elements } of docs.explicit) {
  test(`scanHtml reads the document: ${note}`, () => {
    assert.deepEqual(elementsOf(html), lowered(elements));
  });
}

test('an attribute value of character references decodes to what Chromium makes of it', () => {
  const wrong = [];
  for (const { value, decoded } of values.generated) {
    const got = decodeEntities(value, { bareNumeric: true });
    if (got !== decoded) wrong.push({ value, decoded, got });
  }
  assert.deepEqual(wrong.slice(0, 3), []);
  assert.equal(wrong.length, 0);
});

// Probed: the textContent Chromium gives an svg <style> holding each value.
test('text decodes character references the way the data state does', () => {
  const probed = [
    ['&quothttps', '"https'], ['&notit;', '\u00acit;'], ['&amp=1', '&=1'], ['&ampx', '&x'],
    ['&#58//x', '://x'], ['&#x3a;', ':'], ['&colon;', ':'], ['&colon', '&colon'], ['&lt', '<'],
    ['&AMP;', '&'], ['&nosuch;', '&nosuch;'], ['&#0;', '\ufffd'], ['&#x80;', '\u20ac'], ['a&b', 'a&b'],
  ];
  for (const [value, decoded] of probed) assert.equal(decodeEntities(value, { bareNumeric: true, text: true }), decoded, value);
});

// `--!>` ends a comment but not script-data escaping: after `<!--<script>` inside a
// script, Chromium keeps reading script text through `--!></script>`, so the img is
// text. Each count was probed with JavaScript-off Chromium.
test('--!> ends a comment but not escaped script data', () => {
  const img = 'img src="https://e.example/a.png"';
  const cases = [
    [`<script><!--<script>--!></script><${img}></script><p>`, 0],
    [`<script><!--<script>--></script><${img}></script><p>`, 1],
    [`<script><!--<script></script><${img}></script><p>`, 0],
    [`<p><!-- x --!><${img}><p>`, 1],
  ];
  for (const [html, n] of cases) {
    assert.equal(scanHtml(html).tags.filter((t) => t.name === 'img').length, n, html);
  }
});
