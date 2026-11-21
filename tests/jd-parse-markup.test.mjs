// lib/jd-parse.mjs stripMarkup: which tags are markup, and where a
// script/style block really ends. Both rules have a near-miss that used to be
// read as the real thing, and either one changes what a posting looks like to
// the filters that read its description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMarkup } from '../lib/jd-parse.mjs';

const flat = (markup) => stripMarkup(markup).replace(/\s+/g, ' ').trim();

test('a custom element that starts with a known name keeps its text', () => {
  assert.equal(flat('<style-guide>deadline 2026-10-18</style-guide>after'), 'deadline 2026-10-18 after');
  assert.equal(flat('<script-setup>x</script-setup>after'), 'x after');
});

test('a script or style block ends only at a real closing tag', () => {
  assert.equal(flat('<script>deadline</scripture> still text</script>after'), 'after');
  assert.equal(flat('<style>x</styled> y</STYLE >after'), 'after');
  assert.equal(flat('<script src="x">dead</script>after'), 'after');
});

test('an unclosed block drops the rest instead of leaking its payload as text', () => {
  assert.equal(flat('<p>before</p><script>var deadline = 1;'), 'before');
});
test('the unclosed payload is the caller\'s choice, and the default drops it', () => {
  const input = '<p>before</p><script>var deadline = 1;';
  assert.equal(flat(input), 'before');
  assert.equal(stripMarkup(input, { unclosedPayloadIsText: true }).replace(/\s+/g, ' ').trim(), 'before var deadline = 1;');
  // The payload keeps counting even when many unclosed openers precede it.
  const many = '<script>'.repeat(2000) + 'text that counts';
  assert.match(stripMarkup(many, { unclosedPayloadIsText: true }), /text that counts/);
});

test('a closer with no ">" is not rescanned for every opener', () => {
  // The malformed shape: a boundary-valid `</script ` at the very end with no
  // `>` after it. Every opener used to rescan to that same closer and then
  // resume, which is quadratic on an input the 1 MiB cap allows.
  const input = '<script>'.repeat(20000) + '</script ';
  const started = performance.now();
  const out = stripMarkup(input, { unclosedPayloadIsText: true });
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `took ${Math.round(ms)} ms`);
  assert.equal(out, '</script ', 'the openers are markup; the malformed closer is text');
});
