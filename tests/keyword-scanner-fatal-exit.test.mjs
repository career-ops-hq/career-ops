// scan-seek.mjs and scan-hn.mjs must not call process.exit() when a run fails
// after its requests: on Windows, Node 24 aborts on process.exit() right after
// a request (nodejs/node#56645, the crash in #3788), printing a libuv assertion
// and a crash code instead of the "Fatal:" message and exit 1. Their fatal
// handlers called process.exit(1). Each run here makes its requests against a
// stubbed fetch, then fails on a write that comes after them; the preload turns
// any process.exit() call into exit 99, which fails on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const EXIT_AND_FETCH = `
const { writeSync } = require('node:fs');
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
let requests = 0;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input) => {
  requests++;
  const url = String(input?.url ?? input);
  if (url.includes('hn.algolia.com/api/v1/search_by_date')) return json({ hits: [{ objectID: '424242', title: 'Ask HN: Who is hiring? (September 2026)' }] });
  if (url.includes('hn.algolia.com/api/v1/items/424242')) return json({ children: [{ text: 'Stripe | Software Engineer | Remote | https://stripe.com/jobs/1' }] });
  return new Response('<html><body><h1>No jobs</h1></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
};
process.on('exit', () => { if (requests === 0) writeSync(2, 'no request was made\\n'); });
`;

// Reads of pipeline.md still work (the scanners read it before any request);
// only writing it fails, which happens after the requests.
const PIPELINE_WRITE_FAILS = `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const refuse = (path) => String(path).endsWith('pipeline.md');
const fail = () => Object.assign(new Error('EACCES: permission denied, write'), { code: 'EACCES' });
for (const name of ['writeFileSync', 'appendFileSync']) {
  const real = fs[name];
  fs[name] = function (path, ...rest) { if (refuse(path)) throw fail(); return real.call(this, path, ...rest); };
}
const realRename = fs.renameSync;
fs.renameSync = function (from, to) { if (refuse(to)) throw fail(); return realRename.call(this, from, to); };
syncBuiltinESMExports();
`;

function run(script, setup, preloads) {
  const dir = mkdtempSync(join(tmpdir(), 'keyword-scanner-exit-'));
  try {
    mkdirSync(join(dir, 'data'));
    setup(dir);
    const args = [];
    for (const [name, body] of preloads) {
      const path = join(dir, name);
      writeFileSync(path, body);
      args.push('--require', path);
    }
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    // Every path override the scanners read wins over CAREER_OPS_ROOT, so an
    // inherited one would point this run at the developer's real files. With
    // trusted proxy egress, the request would go through undici, past the stub.
    // Env names are case-insensitive on Windows, so every spelling is dropped.
    const inherited = new Set([
      'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PORTALS', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE',
      'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PROFILE', 'GEMINI_API_KEY', 'GEMINI_MODEL',
      'CAREER_OPS_TRUST_PROXY_EGRESS',
    ]);
    for (const key of Object.keys(env)) if (inherited.has(key.toUpperCase())) delete env[key];
    return spawnSync(process.execPath, [...args, join(ROOT, script)], { cwd: dir, encoding: 'utf8', timeout: 60_000, env });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('scan-seek: a failure after the SEEK requests exits 1 with its message, without calling process.exit', () => {
  const r = run('scan-seek.mjs', (dir) => {
    writeFileSync(join(dir, 'portals.yml'), 'seek_searches:\n  - keyword: "data analyst"\n');
    // The run log is written last; a directory in its place fails that write.
    mkdirSync(join(dir, 'data', 'scan-runs.tsv'));
  }, [['exit-and-fetch.cjs', EXIT_AND_FETCH]]);
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /^Fatal: /m);
  assert.doesNotMatch(r.stderr, /process\.exit called|no request was made/, describeSpawn(r));
});

test('scan-hn: a failure after the HN requests exits 1 with its message, without calling process.exit', () => {
  const r = run('scan-hn.mjs', () => {}, [['pipeline-write-fails.cjs', PIPELINE_WRITE_FAILS], ['exit-and-fetch.cjs', EXIT_AND_FETCH]]);
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /^Fatal: EACCES/m);
  assert.doesNotMatch(r.stderr, /process\.exit called|no request was made/, describeSpawn(r));
});
