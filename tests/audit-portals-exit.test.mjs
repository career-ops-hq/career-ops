// audit-portals.mjs must end with process.exitCode, never process.exit(), once
// its board requests have run: on Windows, Node 24 aborts on process.exit()
// right after a request (nodejs/node#56645; the numbers are in
// audit-portals.mjs). The preload stubs fetch and turns any process.exit() call
// into exit 99, which fails on every platform. A bad --baseline file is refused
// before the first request, so those tests expect the preload's note that no
// request was made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One Greenhouse board, so a provider claims it and the audit requests it.
// Every request answers 404, an `error` verdict. A run that never made a
// request says so on stderr, which fails the empty-stderr checks below.
function runAudit(argsFor, preloadBody = '') {
  const dir = mkdtempSync(join(tmpdir(), 'audit-portals-exit-'));
  try {
    // A checkout with its own .env or config/plugins.yml makes the engine warn on
    // stderr that they sit beside the code, not in the data folder (#7286). An
    // empty copy in the data folder keeps these stderr checks the same for every
    // checkout.
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, 'config', 'plugins.yml'), '');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `tracked_companies:
  - name: Fictional Employer
    careers_url: https://job-boards.greenhouse.io/fictional-employer
    enabled: true
`);
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
    // With trusted proxy egress, the request would go through undici, past the stub.
    delete env.CAREER_OPS_TRUST_PROXY_EGRESS;
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'audit-portals.mjs'),
      '--file', portals, ...argsFor(dir)], { cwd: ROOT, encoding: 'utf8', timeout: 20000, env });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('--strict exits 1 after a failed board request, without calling process.exit', () => {
  const result = runAudit(() => ['--strict']);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stdout, /1 board\(s\) with a non-ok verdict \(--strict\)\./);
  assert.equal(result.stderr, '');
});

test('a missing --baseline file exits 1 before any board request', () => {
  const result = runAudit((dir) => ['--baseline', join(dir, 'missing.json')]);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Error: baseline file not found: .*missing\.json\nno board request was made\n$/);
});

test('an unreadable --baseline file exits 1 before any board request', () => {
  const result = runAudit((dir) => {
    writeFileSync(join(dir, 'baseline.json'), '{ not json');
    return ['--baseline', join(dir, 'baseline.json')];
  });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Error: could not read baseline .*baseline\.json: .+\nno board request was made\n$/);
});

test('a --baseline file with no rows exits 1 before any board request, even under --strict', () => {
  // The --queries --json report: valid JSON, but nothing to compare against.
  const result = runAudit((dir) => {
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ warnings: [] }));
    return ['--baseline', join(dir, 'baseline.json'), '--strict'];
  });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Error: baseline .*baseline\.json has no rows: .+\nno board request was made\n$/);
});

test('a board below its --baseline count still fails --strict, in both shapes --json writes', () => {
  // Six postings now, against 20 in the baseline: a drop, and not a small board.
  const jobs = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, title: `Role ${i + 1}`, absolute_url: `https://job-boards.greenhouse.io/fictional-employer/jobs/${i + 1}`,
  }));
  const sixPostings = `globalThis.fetch = async () => { requests++; return new Response(${JSON.stringify(JSON.stringify({ jobs }))}, { status: 200 }); };`;
  const rows = [{ name: 'Fictional Employer', count: 20 }];
  const drops = [{ name: 'Fictional Employer', before: 40, after: 20, lost: 20 }];
  for (const baseline of [rows, { rows, drops }]) {
    const result = runAudit((dir) => {
      writeFileSync(join(dir, 'baseline.json'), JSON.stringify(baseline));
      return ['--baseline', join(dir, 'baseline.json'), '--strict'];
    }, sixPostings);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stdout, /Fictional Employer: 20 → 6 \(-14\)/);
    assert.match(result.stdout, /🔴 1 board\(s\) below baseline \(--strict\)\./);
    assert.equal(result.stderr, '');
  }
});

test('an error after the requests exits 1 with its message, without calling process.exit', () => {
  // The global console swallows a failing stdout write, so the report fails to
  // print by throwing from console.log itself: main() rejects after its
  // request, which is what sends it to the catch handler.
  const result = runAudit(() => [], `console.log = () => { throw new Error('stdout closed'); };`);
  assert.equal(result.status, 1, describeSpawn(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'audit-portals failed: stdout closed\n');
});
