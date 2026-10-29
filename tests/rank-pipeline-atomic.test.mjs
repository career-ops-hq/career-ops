import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const original = '# Pipeline\n\n- [ ] https://example.test/a | Acme | Engineer\n- [x] https://example.test/b | Globex | Analyst\n';
const ranked = original.replace('Acme | Engineer', 'Acme | Engineer | rank: 4.5/5 — matched');

function scenario({ failure = '', linked = false, concurrent = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rank-atomic-')));
  try {
    mkdirSync(join(root, 'data'));
    const pipeline = join(root, 'data', 'pipeline.md');
    const target = linked ? join(root, 'saved-pipeline.md') : pipeline;
    writeFileSync(target, original);
    chmodSync(target, 0o600);
    if (linked) symlinkSync(target, pipeline);
    const added = '- [ ] https://example.test/new | New | Manager\n';
    const preload = join(root, 'stub.cjs');
    writeFileSync(preload, `
      const fs = require('node:fs');
      const cp = require('node:child_process');
      const path = require('node:path');
      const write = fs.writeFileSync;
      const rename = fs.renameSync;
      const target = ${JSON.stringify(target)};
      const failure = ${JSON.stringify(failure)};
      cp.execFileSync = (bin) => {
        if (bin !== 'fixture-ranker') throw new Error('unexpected CLI: ' + bin);
        ${concurrent ? `write(target, ${JSON.stringify(original + added)});` : ''}
        return '[{"id":0,"score":4.5,"reason":"matched"}]';
      };
      fs.writeFileSync = (file, content, options) => {
        if (failure === 'write' && typeof file === 'string' &&
            (file === target || path.basename(file).startsWith('.' + path.basename(target) + '.'))) {
          write(file, String(content).slice(0, 19), options);
          throw Object.assign(new Error('injected disk full'), { code: 'ENOSPC' });
        }
        return write(file, content, options);
      };
      fs.renameSync = (from, to) => {
        if (failure === 'rename' && to === target)
          throw Object.assign(new Error('injected commit failure'), { code: 'EIO' });
        return rename(from, to);
      };
      require('node:module').syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ['--require', preload, join(ROOT, 'rank-pipeline.mjs'), '--cli', 'fixture-ranker', '--limit', '1'], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root },
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    if (failure) {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, failure === 'write' ? /injected disk full/ : /injected commit failure/);
      assert.equal(readFileSync(target, 'utf8'), original, 'the complete pipeline must survive a failed save');
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(target, 'utf8'), ranked + (concurrent ? added : ''));
    }
    if (linked) assert.ok(lstatSync(pipeline).isSymbolicLink());
    if (process.platform !== 'win32') assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(root, 'data')), ['pipeline.md'], 'no lock or temporary file remains');
    assert.deepEqual(readdirSync(root).sort(), (linked ? ['data', 'saved-pipeline.md', 'stub.cjs'] : ['data', 'stub.cjs']).sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('ranking preserves the full pipeline after a partial disk-full write', () => scenario({ failure: 'write' }));
test('ranking preserves the full pipeline if committing the replacement fails', () => scenario({ failure: 'rename' }));
test('ranking preserves other rows and private permissions on success', () => scenario());
test('ranking retains a row added while the ranker was running', () => scenario({ concurrent: true }));
test('ranking writes through a pipeline symlink', { skip: process.platform === 'win32' && 'file symlink requires privileges' }, () => scenario({ linked: true }));
