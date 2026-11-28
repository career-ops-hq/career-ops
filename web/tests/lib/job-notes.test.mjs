import test from 'node:test';
import assert from 'node:assert/strict';
import { splitJobNotes } from '../../src/lib/job-notes.mjs';

test('existing tracker notes display as separate notes, including legacy prefixes', () => {
  assert.deepEqual(splitJobNotes('; Existing evaluation info; Ask for referral; CV ready'), ['Existing evaluation info', 'Ask for referral', 'CV ready']);
  assert.deepEqual(splitJobNotes('one note, with punctuation'), ['one note, with punctuation']);
});
test('empty and placeholder cells display no notes', () => {
  for (const value of [undefined, '', ' ', '—', '-', '; ']) assert.deepEqual(splitJobNotes(value), []);
});
