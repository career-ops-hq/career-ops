// tests/providers/retry-policy.test.mjs — a verdict about a host is not a
// transient failure.
//
// The blocked-address guard raises an error with no HTTP status, so the retry
// predicate fell through to its "network error" case and retried it. Every
// blocked host then cost three attempts and ~1.7 s of backoff in a sweep that
// touches dozens of boards, and logged a storm of identical failures.
//
// Run:  node --test tests/providers/retry-policy.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const spec = (rel) => pathToFileURL(join(ROOT, rel)).href;

const { isRetryableError } = await import(spec('providers/_http.mjs'));
const { blockedAddressError } = await import(spec('providers/_ip-guard.mjs'));

test('a blocked address is not retried', () => {
  const err = blockedAddressError('metadata.example', '169.254.169.254');
  assert.equal(err.code, 'ECAREEROPS_BLOCKED_ADDRESS');
  assert.equal(isRetryableError(err), false, 'a deterministic verdict must not be retried');
});

test('a blocked address the connector wrapped is not retried either', () => {
  // The common path: a hostname resolves to a private address, the guarded
  // resolver refuses, and fetch rejects with its own error whose `cause` is the
  // verdict. Reading only the top level left this one retrying.
  const wrapped = Object.assign(new TypeError('fetch failed'), {
    cause: blockedAddressError('metadata.example', '169.254.169.254'),
  });
  assert.equal(wrapped.code, undefined, 'the wrapper carries no code of its own');
  assert.equal(isRetryableError(wrapped), false, 'the wrapped verdict must not be retried');
});

test('a genuine network error still is retried', () => {
  // The control: the new branch must not swallow the ambiguous case it joined.
  assert.equal(isRetryableError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
  assert.equal(isRetryableError(new Error('fetch failed')), true);
});

test('a status the server sent still outranks the code check', () => {
  assert.equal(isRetryableError(Object.assign(new Error('rate limited'), { status: 429 })), true);
  assert.equal(isRetryableError(Object.assign(new Error('bad gateway'), { status: 502 })), true);
});