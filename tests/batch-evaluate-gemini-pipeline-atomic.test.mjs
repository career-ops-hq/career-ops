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
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
    symlinkSync(join('..', 'real', 'pipeline.md'), pipeline);
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
    import { finishPipelineBatch } from ${JSON.stringify(join(ROOT, 'batch-evaluate-gemini.mjs'))};
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
      mode: statSync(real).mode & 0o777,
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
  assert.equal(mode, 0o600);
});

test('a killed batch finish leaves the previous pipeline.md', () => {
  const { result, body, mode } = run({ failure: 'kill' });
  assert.equal(result.signal, 'SIGKILL', describeSpawn(result, 'the finish must die on the injected kill'));
  assert.equal(body, ORIGINAL);
  assert.equal(mode, 0o600);
});

test('a finished batch still marks the offer done', () => {
  const { result, body, mode } = run({ failure: '' });
  assert.equal(result.status, 0, describeSpawn(result, 'a normal finish'));
  assert.equal(body, DONE);
  assert.equal(mode, 0o600);
});

test('a finished batch writes through a symlinked pipeline.md', () => {
  const got = run({ failure: '', link: true });
  assert.equal(got.result.status, 0, describeSpawn(got.result, 'a finish through a symlink'));
  assert.equal(got.link, true);
  assert.equal(got.target, join('..', 'real', 'pipeline.md'));
  assert.equal(got.body, DONE);
  assert.equal(got.mode, 0o600);
});

test('a killed batch finish leaves a symlinked pipeline.md in place', () => {
  const got = run({ failure: 'kill', link: true });
  assert.equal(got.result.signal, 'SIGKILL', describeSpawn(got.result, 'a kill through a symlink'));
  assert.equal(got.link, true);
  assert.equal(got.target, join('..', 'real', 'pipeline.md'));
  assert.equal(got.body, ORIGINAL);
  assert.equal(got.mode, 0o600);
});
