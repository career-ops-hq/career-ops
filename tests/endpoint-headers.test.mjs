// tests/endpoint-headers.test.mjs — per-endpoint request headers for openai-eval.mjs.
//
// OpenCode Go (https://opencode.ai/zen/go/v1) rejects clients that do not send
// a session id (HTTP 400 MissingSessionID) and asks them to identify themselves
// with their own user agent. These tests pin the host gate (every other
// endpoint keeps its headers untouched) and that openai-eval.mjs wires the
// helper with one session id per process run.
//
// Run:  node --test tests/endpoint-headers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpointHeaders } from '../lib/endpoint-headers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION = '3b241101-e2bb-4255-8caf-4136c566a962';

test('opencode.ai gets the session header with the id it was given', () => {
  const h = endpointHeaders('opencode.ai', SESSION, '1.38.0');
  assert.equal(h['x-opencode-session'], SESSION);
});

test('opencode.ai gets career-ops own User-Agent with the version', () => {
  const ua = endpointHeaders('opencode.ai', SESSION, '1.38.0')['User-Agent'];
  assert.equal(ua, 'career-ops/1.38.0');
  assert.doesNotMatch(ua, /node|undici|fetch|axios|openai|curl|python/i);
});

test('the User-Agent falls back to a versioned career-ops string without a version', () => {
  const ua = endpointHeaders('opencode.ai', SESSION)['User-Agent'];
  assert.match(ua, /^career-ops\/\d/);
});

for (const host of [
  'openrouter.ai',
  'api.openai.com',
  'router.requesty.ai',
  'localhost',
  '127.0.0.1',
  '::1',
  'opencode.ai.evil.com',
  'notopencode.ai',
  'evil.com/opencode.ai',
  '',
  undefined,
]) {
  test(`host ${JSON.stringify(host)} gets no extra headers`, () => {
    assert.deepEqual(endpointHeaders(host, SESSION, '1.38.0'), {});
  });
}

test('openai-eval.mjs merges endpointHeaders into its request headers', () => {
  const src = readFileSync(join(ROOT, 'openai-eval.mjs'), 'utf-8');
  assert.match(src, /from '\.\/lib\/endpoint-headers\.mjs'/);
  assert.match(src, /endpointHeaders\(\s*endpointHost\b/);
});

test('openai-eval.mjs generates the session id once per run, at module level', () => {
  const src = readFileSync(join(ROOT, 'openai-eval.mjs'), 'utf-8');
  const calls = src.match(/randomUUID\(\)/g) || [];
  assert.equal(calls.length, 1, 'exactly one randomUUID() call');
  assert.match(src, /^const \w+ = randomUUID\(\);/m, 'assigned at module level (column 0)');
});
