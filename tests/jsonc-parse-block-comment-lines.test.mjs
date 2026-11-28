import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonc, stripJsoncSyntax } from '../jsonc-parse.mjs';

test('block comments keep their line breaks', () => {
  const source = [
    '{',
    '  /* a comment',
    '     that spans lines */',
    '  "a": 1,',
    '  "b": 2',
    '}',
  ].join('\n');

  const stripped = stripJsoncSyntax(source);
  assert.equal(stripped.split('\n').length, source.split('\n').length);
  assert.deepEqual(parseJsonc(source), { a: 1, b: 2 });
});

test('a parse error keeps its line number after a block comment', () => {
  const source = [
    '{',
    '  /* a comment',
    '     that spans lines */',
    '  "a": 1',
    '  "b": 2',
    '}',
  ].join('\n');

  assert.throws(
    () => parseJsonc(source),
    (err) => /line 5/.test(err.message),
  );
});
