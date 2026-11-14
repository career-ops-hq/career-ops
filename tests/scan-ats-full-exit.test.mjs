// scan-ats-full.mjs must end by setting process.exitCode and letting the event
// loop drain, not by calling process.exit() as soon as main() settles: on
// Windows, Node aborts on process.exit() right after a request
// (nodejs/node#56645; the versions and the numbers are in scan-ats-full.mjs).
// The preload stubs fetch and turns any process.exit() call into exit 99, which
// fails on every platform. The backstop check holds the event loop open, the
// way #5570 saw it held, and expects the backstop timer to end the run anyway.
// The SIGTERM checks hold it open until a SIGTERM comes, which must not add a
// partial --json result once main() has settled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One Greenhouse board from a fresh company-list cache, so the only request is
// the board's own, and the stub answers it with an empty board. A run that never
// made a request says so on stderr, which fails the stderr checks below.
// `passExit` lets a process.exit() call through with its own code instead of 99.
function runScan(args, { preloadBody = '', passExit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-ats-full-exit-'));
  try {
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - engineer\n');
    const cache = join(dir, 'data', 'cache', 'ats-companies');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'greenhouse.json'), JSON.stringify(['fictional-employer']));
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `import { writeSync } from 'node:fs';
const exit = process.exit;
process.exit = (code) => { writeSync(2, 'process.exit called with ' + code + '\\n'); exit(${passExit ? 'code' : '99'}); };
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
process.on('exit', () => { if (requests === 0) writeSync(2, 'no board request was made\\n'); });
${preloadBody}`);
    // Empty overrides fall back to CAREER_OPS_ROOT, so the run reads only the
    // fixture above and none of the developer's own files.
    const env = {
      ...process.env,
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_PROFILE: '',
      CAREER_OPS_PORTALS: '',
      CAREER_OPS_PIPELINE: '',
      CAREER_OPS_SCAN_HISTORY: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0',
    };
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan-ats-full.mjs'),
      '--ats', 'greenhouse', '--dry-run', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a sweep exits 0 after its requests, without calling process.exit', () => {
  const result = runScan([]);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /Companies scanned: {2}1\n/);
  assert.match(result.stdout, /\nNothing new\.\n$/);
  assert.equal(result.stderr, '');
});

test('--json exits 0 with the whole result on stdout, without calling process.exit', () => {
  const result = runScan(['--json']);
  assert.equal(result.status, 0, describeSpawn(result));
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.companiesScanned, 1);
  assert.deepEqual(summary.offers, []);
  // Under --json the progress and the summary lines go to stderr.
  assert.doesNotMatch(result.stderr, /process\.exit called|no board request was made/);
});

test('an error after the sweep exits 1 with its message, without calling process.exit', () => {
  // The summary's first line throws, so main() rejects after the board request,
  // which is what sends it to the catch handler.
  const result = runScan([], { preloadBody: `const log = console.log;
console.log = (...a) => { if (String(a[0]).startsWith('Companies scanned:')) throw new Error('stdout closed'); return log(...a); };` });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stderr, 'Fatal: stdout closed\n');
});

test('a sweep whose event loop stays open still exits 0 once the backstop fires (#5570)', () => {
  // A ref'd interval that nothing clears holds the loop open after the summary.
  // Without the backstop this run would last until the spawn timeout.
  const result = runScan([], { preloadBody: 'setInterval(() => {}, 1000);', passExit: true });
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /\nNothing new\.\n$/);
  assert.equal(result.stderr, 'process.exit called with 0\n');
});

// Holds the event loop open after the run until a SIGTERM comes, then lets go,
// so the run ends at once with the exit code main() left. `sigterm()` sends it.
// process.emit runs the SIGTERM listeners the way a delivered signal does, on
// every platform: a real SIGTERM ends a Windows process without running them.
const HOLD_UNTIL_SIGTERM = `const hold = setInterval(() => {}, 1000);
process.on('SIGTERM', () => clearInterval(hold));
const sigterm = () => setImmediate(() => process.emit('SIGTERM'));
`;

test('--json: a SIGTERM after the complete result adds no partial one and keeps exit 0', () => {
  // The SIGTERM comes right after the complete result is written, while the
  // process waits for its event loop to drain.
  const result = runScan(['--json'], { preloadBody: `${HOLD_UNTIL_SIGTERM}
const write = process.stdout.write.bind(process.stdout);
let sent = false;
process.stdout.write = (chunk, ...rest) => {
  if (!sent && String(chunk).startsWith('{')) { sent = true; sigterm(); }
  return write(chunk, ...rest);
};` });
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(result.stdout.split('\n').filter(Boolean).length, 1, describeSpawn(result));
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.companiesScanned, 1);
  assert.equal(summary.stoppedEarly, undefined);
  assert.doesNotMatch(result.stderr, /process\.exit called|no board request was made/);
});

test('--json: a SIGTERM after an error prints no partial result and keeps exit 1', () => {
  // Under --json the summary goes to stderr, so its first line throws there,
  // and the SIGTERM comes right after the catch handler prints the error.
  const result = runScan(['--json'], { preloadBody: `${HOLD_UNTIL_SIGTERM}
const error = console.error;
console.error = (...a) => {
  if (String(a[0]).startsWith('Companies scanned:')) throw new Error('stderr closed');
  error(...a);
  if (a[0] === 'Fatal:') sigterm();
};` });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /(^|\n)Fatal: stderr closed\n$/);
  assert.doesNotMatch(result.stderr, /process\.exit called|no board request was made/);
});
