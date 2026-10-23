import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';

test('pruning a deleted PDF preserves a concurrent renderer manifest entry', { timeout: 20_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pdf-prune-writer-')));
  let lock;
  let child;
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'output'));
    const manifest = join(root, 'data', 'pdf-index.tsv');
    const tracker = join(root, 'data', 'applications.md');
    const gate = join(root, 'writer-published');
    const header = '# report\tpdf\thtml\tformat\tdate\tkind\n';
    const deleted = '1\toutput/1-deleted.pdf\t\ta4\t2026-01-01\tcv\n';
    const live = '3\toutput/3-live.pdf\t\ta4\t2026-01-01\tcv\n';
    const published = '2\toutput/2-new.pdf\t\ta4\t2026-01-01\tcv\n';
    writeFileSync(manifest, header + deleted + live);
    writeFileSync(tracker, '# untouched tracker\n');
    writeFileSync(join(root, 'output', '3-live.pdf'), '%PDF-1.4\n');
    writeFileSync(join(root, 'output', '2-new.pdf'), '%PDF-1.4\n');
    const hook = join(root, 'prune-barrier.cjs');
    writeFileSync(hook, `
const fs = require('node:fs');
const read = fs.readFileSync;
const mkdir = fs.mkdirSync;
const manifest = process.env.CAREER_OPS_PDF_INDEX;
let signalled = false;
fs.mkdirSync = function (path, ...args) {
  if (String(path) === manifest + '.lock' && !signalled) {
    signalled = true;
    process.send('lock-attempt');
  }
  return mkdir(path, ...args);
};
fs.readFileSync = function (path, ...args) {
  const content = read(path, ...args);
  if (String(path) === manifest && !signalled) {
    signalled = true;
    process.send('snapshot');
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(process.env.PDF_PRUNE_GATE)) {
      if (Date.now() > deadline) throw new Error('writer barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return content;
};
require('node:module').syncBuiltinESMExports();
`);
    // Hold the same manifest lock the renderer holds across read/update/write.
    // The child either waits for it or snapshots the old manifest without it.
    lock = await acquirePipelineLock(manifest);
    child = spawn(process.execPath, ['--require', hook, fileURLToPath(new URL('../sync-pdf-flags.mjs', import.meta.url)), '--prune', '--write', '--json'], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: manifest, PDF_PRUNE_GATE: gate },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('prune never reached the read/lock barrier: ' + output)), 10_000);
      child.once('message', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    writeFileAtomic(manifest, header + deleted + live + published);
    writeFileSync(gate, 'published');
    lock.release();
    lock = null;
    assert.equal(await exited, 0, output);
    assert.equal(readFileSync(manifest, 'utf8'), header + live + published, 'prune must keep the row published by the lock holder');
    assert.equal(readFileSync(tracker, 'utf8'), '# untouched tracker\n');
    assert.ok(!existsSync(manifest + '.lock'), 'manifest lock must be released');
  } finally {
    lock?.release();
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
