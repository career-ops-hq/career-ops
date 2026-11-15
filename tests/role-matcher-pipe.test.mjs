import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFuzzyMatch } from '../role-matcher.mjs';

test('a pipe and the stored slash are the same title', () => {
  assert.equal(roleFuzzyMatch('VP | Engineering', 'VP / Engineering'), true);
  assert.equal(roleFuzzyMatch('Manager | Platform', 'Manager / Platform'), true);
});

test('a pipe does not merge two different titles', () => {
  assert.equal(roleFuzzyMatch('VP | Engineering', 'VP / Sales'), false);
});
