// tests/scan-hn-http-context.test.mjs — scan-hn fetches Hacker News through the same
// HTTP context scan.mjs gives every provider (providers/_http.mjs makeHttpCtx).
//
// It used to hand the provider `fetchJson: (url) => fetch(url).json()`, which dropped
// everything the shared context does: no timeout or body cap of its own, no HTTP
// status (a 503 page surfaced as "Unexpected token '<'"), and the `redirect: 'error'`
// the hackernews provider asks for was ignored.
// Offline: the scanner runs with a fetch fixture and nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

function runWithAlgolia(dir, behaviour) {
  const log = join(dir, 'algolia-requests.jsonl');
  const preload = join(dir, 'fetch-fixture.cjs');
  writeFileSync(preload, `
    const { appendFileSync } = require('node:fs');
    globalThis.fetch = async function (input, init) {
      const url = String(input?.url ?? input);
      if (url.includes('hn.algolia.com')) {
        appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url, redirect: init?.redirect ?? null }) + '\\n');
        ${behaviour}
      }
      throw new Error('network forbidden in test: ' + url);
    };
  `);
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' };
  delete env.CAREER_OPS_PORTALS; delete env.GEMINI_API_KEY; delete env.GEMINI_MODEL;
  // With a trusted proxy the shared helper switches to undici's own fetch and skips the fixture.
  // Env names are case-insensitive on Windows, so drop every spelling of the flag.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'CAREER_OPS_TRUST_PROXY_EGRESS') delete env[key];
  }
  const r = spawnSync(process.execPath, ['--require', preload, fileURLToPath(new URL('../scan-hn.mjs', import.meta.url))],
    { cwd: dir, encoding: 'utf8', timeout: 60000, env });
  const requests = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { r, requests };
}

test('a 503 page from Algolia reports the HTTP status, not a JSON syntax error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-http-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const { r } = runWithAlgolia(dir, `return new Response('<html><body>Service Unavailable</body></html>', { status: 503, headers: { 'content-type': 'text/html' } });`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(exitedNonZero(r), describeSpawn(r, 'a failed fetch must make scan-hn exit non-zero'));
    assert.match(output, /503/, `the HTTP status should be named:\n${output}`);
    assert.doesNotMatch(output, /Unexpected token/, `the raw JSON parse error should not leak:\n${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('the redirect policy the hackernews provider asks for reaches fetch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-http-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const { requests } = runWithAlgolia(dir, `return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });`);
    assert.ok(requests.length > 0, 'the scanner should have asked Algolia for the thread');
    assert.equal(requests[0].redirect, 'error', 'redirect:"error" was dropped on the way to fetch');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
