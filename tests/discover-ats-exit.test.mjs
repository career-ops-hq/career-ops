// discover-ats.mjs must not call process.exit() once its probes have run: on
// Windows, Node 24 aborts on process.exit() right after a request
// (nodejs/node#56645, the crash in #3788; the numbers are in discover-ats.mjs).
// The preload stubs fetch and turns any process.exit() call into exit 99, which
// fails on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One company, probed on Greenhouse only. Every request answers 404, so the
// company ends unresolved. A run that never made a request says so on stderr,
// which fails the stderr checks below.
function runDiscover(preloadBody = '') {
  const dir = mkdtempSync(join(tmpdir(), 'discover-ats-exit-'));
  try {
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(99); };
let requests = 0;
globalThis.fetch = async () => { requests++; return new Response('', { status: 404 }); };
process.on('exit', () => { if (requests === 0) writeSync(2, 'no board request was made\\n'); });
${preloadBody}`);
    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir };
    delete env.CAREER_OPS_PORTALS;
    delete env.CAREER_OPS_BLACKLIST;
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'discover-ats.mjs'),
      'Fictional Employer', '--vendors', 'gh'], { cwd: ROOT, encoding: 'utf8', timeout: 20000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a run that probed a board exits 0 with its report, without calling process.exit', () => {
  const result = runDiscover();
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(JSON.parse(result.stdout).metadata.unresolved, 1);
  assert.equal(result.stderr, '');
});

test('an error after the probes exits 1 with its message, without calling process.exit', () => {
  // main() prints its report last, so a throwing console.log rejects it after
  // the request, which is what sends it to the catch handler.
  const result = runDiscover(`console.log = () => { throw new Error('stdout closed'); };`);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  // The handler prints the error's stack: its message, then only "at" frames.
  const [message, ...frames] = result.stderr.trimEnd().split('\n');
  assert.match(message, /^discover-ats: (Error: )?stdout closed$/);
  assert.ok(frames.every((line) => line.startsWith('    at ')), describeSpawn(result));
});
