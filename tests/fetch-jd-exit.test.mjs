// fetch-jd.mjs must end with process.exitCode, never process.exit(), once a
// request has run: on Windows, Node 24 aborts on process.exit() right after a
// request (nodejs/node#56645; the numbers are in fetch-jd.mjs). A local server
// never triggered the abort (HTTP or HTTPS, a gzipped body, an answer delayed
// up to 1.5 s), so these tests don't wait for it. The preload stubs fetch and
// turns any process.exit() call into exit 99, which fails on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POSTING = 'https://job-boards.greenhouse.io/fictional-employer/jobs/12345';

function runFetchJd(preloadBody) {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-jd-exit-'));
  try {
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
${preloadBody}`);
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'fetch-jd.mjs'), POSTING],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a miss exits 1, silently, without calling process.exit', () => {
  const result = runFetchJd(`globalThis.fetch = async () => new Response('', { status: 404 });`);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('an error after the request exits 1 with its message, without calling process.exit', () => {
  // A hit whose JD cannot be written: main() rejects after its request, which
  // is what sends it to the catch handler.
  const result = runFetchJd(`globalThis.fetch = async () => new Response(JSON.stringify({ title: 'Fixture Engineer', content: '<p>Builds fixtures.</p>' }));
process.stdout.write = () => { throw new Error('stdout closed'); };`);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'fetch-jd: unexpected error — stdout closed\n');
});
