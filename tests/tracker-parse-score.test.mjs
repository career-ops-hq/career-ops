#!/usr/bin/env node
/**
 * Focused unit coverage for parseScore exported from tracker-parse.mjs (#4962).
 *
 * Verifies that parseScore extracts numeric scores, strips bolding, normalizes
 * decimal commas, and strictly returns 0 for non-numeric/sentinel values.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../tracker-parse.mjs';

test('parseScore parses integers and decimal scores', () => {
  assert.equal(parseScore('5'), 5);
  assert.equal(parseScore('4'), 4);
  assert.equal(parseScore('4.2'), 4.2);
  assert.equal(parseScore('4.2/5'), 4.2);
  assert.equal(parseScore('3.75/5'), 3.75);
});

test('parseScore strips markdown bold formatting', () => {
  assert.equal(parseScore('**4**'), 4);
  assert.equal(parseScore('**4.3**'), 4.3);
  assert.equal(parseScore('**4.3/5**'), 4.3);
  assert.equal(parseScore('**5/5**'), 5);
});

test('parseScore normalizes European decimal commas', () => {
  assert.equal(parseScore('4,5/5'), 4.5);
  assert.equal(parseScore('3,8'), 3.8);
  assert.equal(parseScore('**4,2/5**'), 4.2);
});

test('parseScore parses scores with trailing or contextual text', () => {
  assert.equal(parseScore('4.2 (strong fit)'), 4.2);
  assert.equal(parseScore('**4.2** (strong match)'), 4.2);
  assert.equal(parseScore('4.5 - high signal'), 4.5);
});

test('parseScore preserves documented tracker no-score sentinels as 0 (#2803)', () => {
  assert.equal(parseScore('N/A'), 0);
  assert.equal(parseScore('n/a'), 0);
  assert.equal(parseScore('—'), 0);
  assert.equal(parseScore('-'), 0);
  assert.equal(parseScore('DUP'), 0);
  assert.equal(parseScore('unknown'), 0);
});

test('parseScore handles empty, null, or undefined values gracefully as 0', () => {
  assert.equal(parseScore(''), 0);
  assert.equal(parseScore('   '), 0);
  assert.equal(parseScore(null), 0);
  assert.equal(parseScore(undefined), 0);
});
