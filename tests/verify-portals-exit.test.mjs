// verify-portals.mjs must end with process.exitCode, never process.exit(), once
// its board requests have run: on Windows, Node 24 aborts on process.exit()
// right after a request (nodejs/node#56645; the numbers are in
// verify-portals.mjs). The preload stubs fetch and turns any process.exit() call
// into exit 99, which fails on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One Greenhouse board, which the sweep requests first.
const BOARD = `tracked_companies:
  - name: Fictional Employer
    careers_url: https://job-boards.greenhouse.io/fictional-employer
    enabled: true
`;

// `answer` is the body of the stubbed fetch. Every request answers 404 by
// default, so the board is unresolved. A run that never made a request says so
// on stderr, which fails the stderr checks below.
function runVerify(portalsYml, args, { answer = `new Response('', { status: 404 })`, preloadBody = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-portals-exit-'));
  try {
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, portalsYml);
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
let requests = 0;
globalThis.fetch = async () => { requests++; return ${answer}; };
process.on('exit', () => { if (requests === 0) writeSync(2, 'no board request was made\\n'); });
${preloadBody}`);
    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir };
    delete env.CAREER_OPS_PORTALS;
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'verify-portals.mjs'),
      '--file', portals, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 20000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('--strict exits 1 after an unresolved board, without calling process.exit', () => {
  const result = runVerify(BOARD, ['--strict']);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stdout, /0 live, 0 live-but-empty, 1 unresolved/);
  assert.match(result.stdout, /🔴 Unresolved slugs found \(--strict\)\.\n$/);
  assert.equal(result.stderr, '');
});

test('--unmined --strict exits 1 after finding a board, without calling process.exit', () => {
  // A name that only search_queries mentions, and a Greenhouse board for it.
  const queries = `search_queries:
  - name: Fictional query
    query: '"Fictional Employer" engineer'
    enabled: true
`;
  const result = runVerify(queries, ['--unmined', '--strict'],
    { answer: `new Response(JSON.stringify({ jobs: [{ id: 1 }] }), { status: 200 })` });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stdout, /fictional employer — greenhouse\/fictionalemployer \(1 jobs\)/);
  assert.match(result.stdout, /1 of 1 have a real board\./);
  assert.equal(result.stderr, '');
});

test('an error after the requests exits 1 with its message, without calling process.exit', () => {
  // The global console swallows a failing stdout write, so the report fails to
  // print by throwing from console.log itself: main() rejects after its
  // request, which is what sends it to the catch handler.
  const result = runVerify(BOARD, [], { preloadBody: `console.log = () => { throw new Error('stdout closed'); };` });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'verify-portals failed: stdout closed\n');
});
