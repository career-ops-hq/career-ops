import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';

test('a first reverse sweep preserves a pipeline created by a concurrent writer', { timeout: 20_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ats-full-create-')));
  const pipeline = join(root, 'data', 'pipeline.md');
  const gate = join(root, 'published');
  let lock;
  let child;
  let exited;
  try {
    mkdirSync(join(root, 'data', 'cache', 'ats-companies'), { recursive: true });
    writeFileSync(join(root, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n');
    writeFileSync(join(root, 'data', 'cache', 'ats-companies', 'greenhouse.json'), '["sandbox-co"]');
    const preload = join(root, 'preload.mjs');
    writeFileSync(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import provider from ${JSON.stringify(new URL('../providers/greenhouse.mjs', import.meta.url).href)};
provider.fetchListing = undefined;
provider.fetch = async () => [{ title: 'Director of Engineering', company: 'Sandbox', location: 'Remote', postedAt: Date.now(), description: '', url: 'https://job-boards.greenhouse.io/sandbox-co/jobs/1234' }];
globalThis.fetch = async () => { throw new Error('unexpected network request'); };
const pipeline = process.env.TEST_PIPELINE;
const exists = fs.existsSync;
const mkdir = fs.mkdirSync;
let signalled = false;
fs.existsSync = function(path) {
  const result = exists(path);
  const caller = new Error().stack.split('\\n')[2];
  if (String(path) === pipeline && !result && caller.includes('scan-ats-full.mjs:') && !signalled) {
    signalled = true;
    process.send('missing-snapshot');
    const deadline = Date.now() + 10_000;
    while (!exists(process.env.TEST_GATE)) {
      if (Date.now() > deadline) throw new Error('writer barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return result;
};
fs.mkdirSync = function(path, ...args) {
  if (String(path) === pipeline + '.lock' && !signalled) {
    signalled = true;
    process.send('lock-attempt');
  }
  return mkdir(path, ...args);
};
syncBuiltinESMExports();
`);
    lock = await acquirePipelineLock(pipeline);
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, fileURLToPath(new URL('../scan-ats-full.mjs', import.meta.url)), '--ats', 'greenhouse', '--json'], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', TEST_PIPELINE: pipeline, TEST_GATE: gate, CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('scanner never reached the barrier: ' + output)), 10_000);
      child.once('message', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    writeFileAtomic(pipeline, '# Pipeline\n\n## Pending\n\n- [ ] https://example.com/concurrent\n\n## Processed\n');
    writeFileSync(gate, 'published');
    lock.release();
    lock = null;
    assert.equal(await exited, 0, output);
    const saved = readFileSync(pipeline, 'utf8');
    assert.deepEqual(saved.match(/https:\/\/[^\s)]+/g)?.sort(), [
      'https://example.com/concurrent',
      'https://job-boards.greenhouse.io/sandbox-co/jobs/1234',
    ], 'both complete lead URLs must survive first-run initialization');
    assert.match(saved, /## Processed/);
    assert.ok(!existsSync(pipeline + '.lock'));
  } finally {
    child?.kill();
    if (exited) await exited;
    lock?.release();
    rmSync(root, { recursive: true, force: true });
  }
});
