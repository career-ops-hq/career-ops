// tests/board-keyword-scope.test.mjs — markKeywordScope() tags a board read
// through keyword queries only, in the shape providers/_types.js asks for
// (#7315), and leaves a whole-board read alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markKeywordScope, markTruncated, boardTruncation } from '../lib/board-truncation.mjs';

test('non-blank keywords scope the board, trimmed, on the same array', () => {
  const jobs = [{ title: 'a' }];
  const out = markKeywordScope(jobs, 'keywords', [' AI ', '大模型']);
  assert.equal(out, jobs);
  assert.deepEqual(out.queryScope, { config: 'keywords', queries: ['AI', '大模型'] });
});

test('a blank keyword is a whole-board query, so the board is not scoped', () => {
  for (const queries of [[''], ['AI', ''], ['  '], [], undefined, 'AI']) {
    assert.equal(markKeywordScope([], 'keywords', queries).queryScope, undefined, JSON.stringify(queries));
  }
});

test('a partly read board keeps its truncation mark next to the scope', () => {
  const jobs = markKeywordScope(markTruncated([{ title: 'a' }], 'fetch-error', { fetched: 1 }), 'keywords', ['AI']);
  assert.equal(boardTruncation(jobs)?.reason, 'fetch-error');
  assert.deepEqual(jobs.queryScope, { config: 'keywords', queries: ['AI'] });
});
