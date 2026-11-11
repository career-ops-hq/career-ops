// A batch finish that dies while writing pipeline.md must leave the previous
// offers in place. A symlink to that file must still be a symlink afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_URL = pathToFileURL(join(ROOT, 'batch-evaluate-gemini.mjs')).href;
const IS_WINDOWS = process.platform === 'win32';
const ORIGINAL = [
  '# Pipeline',
  '',
  '## Pending',
  '- [ ] https://example.test/jobs/1 | Fixture Co | Analyst | Springfield, IL',
  '',
].join('\n');
const DONE = ORIGINAL.replace('- [ ]', '- [x]');

function run({ failure, link = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-atomic-'));
  const realDir = join(dir, 'real');
  mkdirSync(realDir);
  const real = join(realDir, 'pipeline.md');
  writeFileSync(real, ORIGINAL);
  chmodSync(real, 0o600);
  let pipeline = real;
  if (link) {
    const linkDir = join(dir, 'link');
    mkdirSync(linkDir);
    pipeline = join(linkDir, 'pipeline.md');
    try {
      symlinkSync(join('..', 'real', 'pipeline.md'), pipeline);
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) return { skip: err.code };
      throw err;
    }
  }
  const preload = join(dir, 'preload.cjs');
  const worker = join(dir, 'worker.mjs');
  writeFileSync(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const write = fs.writeFileSync;
    const failure = ${JSON.stringify(failure)};
    function isPipelineWrite(file) {
      if (typeof file !== 'string') return false;
      const base = path.basename(file);
      return base === 'pipeline.md' || base.startsWith('.pipeline.md.');
    }
    fs.writeFileSync = (file, content, options) => {
      if (failure && isPipelineWrite(file)) {
        if (failure === 'kill') {
          write(file, '', options);
          // A direct write, so the marker is in the pipe before SIGKILL.
          fs.writeSync(2, 'batch-atomic-kill\\n');
          process.kill(process.pid, 'SIGKILL');
        }
        write(file, String(content).slice(0, 19), options);
        const err = new Error('injected disk full');
        err.code = 'ENOSPC';
        throw err;
      }
      return write(file, content, options);
    };
    require('node:module').syncBuiltinESMExports();
  `);
  writeFileSync(worker, `
    import { finishPipelineBatch } from ${JSON.stringify(BATCH_URL)};
    const pipeline = ${JSON.stringify(pipeline)};
    const original = ${JSON.stringify(ORIGINAL)};
    const snapshot = original.split('\\n');
    const idx = snapshot.findIndex((line) => line.startsWith('- [ ]'));
    const results = new Map([[idx, { line: snapshot[idx].replace('- [ ]', '- [x]'), processed: true }]]);
    await finishPipelineBatch(pipeline, snapshot, results);
  `);
  try {
    const result = spawnSync(process.execPath, ['--require', preload, worker], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir },
      encoding: 'utf8',
      timeout: 30_000,
    });
    return {
      result,
      body: readFileSync(real, 'utf8'),
      link: link ? lstatSync(pipeline).isSymbolicLink() : null,
      target: link ? readlinkSync(pipeline) : null,
      mode: IS_WINDOWS ? null : statSync(real).mode & 0o777,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a disk-full batch finish leaves the previous pipeline.md', () => {
  const { result, body, mode } = run({ failure: 'enospc' });
  assert.ok(exitedNonZero(result), describeSpawn(result, 'disk full must fail the finish'));
  assert.match(result.stderr, /ENOSPC|injected disk full/);
  assert.equal(body, ORIGINAL);
  if (!IS_WINDOWS) assert.equal(mode, 0o600);
});

test('a killed batch finish leaves the previous pipeline.md', () => {
  const { result, body, mode } = run({ failure: 'kill' });
  // Windows reports a killed child as a non-zero status and no signal.
  // The marker is written on the line before the kill, so an earlier throw
  // cannot pass this test by leaving the old file in place.
  assert.match(result.stderr ?? '', /batch-atomic-kill/);
  const killed = result.signal === 'SIGKILL' || (IS_WINDOWS && exitedNonZero(result));
  assert.ok(killed, describeSpawn(result, 'the finish must die on the injected kill'));
  assert.equal(body, ORIGINAL);
  if (!IS_WINDOWS) assert.equal(mode, 0o600);
});

test('a finished batch still marks the offer done', () => {
  const { result, body, mode } = run({ failure: '' });
  assert.equal(result.status, 0, describeSpawn(result, 'a normal finish'));
  assert.equal(body, DONE);
  if (!IS_WINDOWS) assert.equal(mode, 0o600);
});

test('a finished batch writes through a symlinked pipeline.md', (t) => {
  const got = run({ failure: '', link: true });
  if (got.skip) return t.skip(`file symlink unavailable (${got.skip})`);
  assert.equal(got.result.status, 0, describeSpawn(got.result, 'a finish through a symlink'));
  assert.equal(got.link, true);
  assert.equal(got.target, join('..', 'real', 'pipeline.md'));
  assert.equal(got.body, DONE);
  if (!IS_WINDOWS) assert.equal(got.mode, 0o600);
});

test('a killed batch finish leaves a symlinked pipeline.md in place', (t) => {
  const got = run({ failure: 'kill', link: true });
  if (got.skip) return t.skip(`file symlink unavailable (${got.skip})`);
  assert.match(got.result.stderr ?? '', /batch-atomic-kill/);
  const killed = got.result.signal === 'SIGKILL' || (IS_WINDOWS && exitedNonZero(got.result));
  assert.ok(killed, describeSpawn(got.result, 'a kill through a symlink'));
  assert.equal(got.link, true);
  assert.equal(got.target, join('..', 'real', 'pipeline.md'));
  assert.equal(got.body, ORIGINAL);
  if (!IS_WINDOWS) assert.equal(got.mode, 0o600);
});
