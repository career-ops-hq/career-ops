import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const payload = {
  num: '035', today: '2026-10-22', company: 'Globex', role: 'Analyst', score: '4.2/5',
  reportFile: '035-globex-2026-10-22.md', markdown: '# New evaluation\n', notes: 'synthetic fixture',
};
const previous = 'previous application artifact\n';

function scenario(kind) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eval-exclusive-')));
  try {
    const reports = join(root, 'reports');
    const additions = join(root, 'batch', 'tracker-additions');
    mkdirSync(reports, { recursive: true });
    mkdirSync(additions, { recursive: true });
    const report = join(reports, payload.reportFile);
    const tsv = join(additions, '035-globex.tsv');
    const external = join(root, 'other-application.md');
    if (kind === 'report') writeFileSync(report, previous);
    if (kind === 'tsv') writeFileSync(tsv, previous);
    if (kind === 'symlink') {
      writeFileSync(external, previous);
      symlinkSync(external, report);
    }
    const preload = join(root, 'stub.cjs');
    writeFileSync(preload, `
      const fs = require('node:fs');
      const write = fs.writeFileSync, open = fs.openSync, exists = fs.existsSync;
      const report = ${JSON.stringify(report)}, tsv = ${JSON.stringify(tsv)};
      const kind = ${JSON.stringify(kind)}, descriptors = new Map();
      let published = false;
      function competingSave(file) {
        if (kind === 'race' && file === report && !published) {
          published = true;
          write(report, ${JSON.stringify(previous)});
        }
      }
      fs.existsSync = file => {
        if (kind === 'race' && file === report) { competingSave(file); return false; }
        return exists(file);
      };
      fs.openSync = (file, flags, mode) => {
        competingSave(file);
        const fd = open(file, flags, mode);
        descriptors.set(fd, file);
        return fd;
      };
      fs.writeFileSync = (file, content, options) => {
        if (kind === 'partial' && (file === tsv || descriptors.get(file) === tsv)) {
          write(file, String(content).slice(0, 7), options);
          throw Object.assign(new Error('injected incomplete TSV write'), { code: 'EIO' });
        }
        return write(file, content, options);
      };
      require('node:module').syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ['--require', preload, join(ROOT, 'persist-evaluation-report.mjs')], {
      cwd: root, input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    if (kind === 'success') {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true });
      assert.equal(readFileSync(report, 'utf8'), payload.markdown);
      assert.match(readFileSync(tsv, 'utf8'), /Globex\tAnalyst/);
    } else {
      assert.equal(result.status, 1, 'a conflicting or incomplete save must fail');
      assert.equal(result.stdout, '', 'a failed save must not report success');
      if (kind === 'partial') {
        assert.match(result.stderr, /injected incomplete TSV write/);
        assert.equal(existsSync(report), false);
        assert.equal(existsSync(tsv), false);
      } else if (kind === 'tsv') {
        assert.equal(readFileSync(tsv, 'utf8'), previous);
        assert.equal(existsSync(report), false, 'rollback removes only the new report');
      } else {
        assert.equal(readFileSync(report, 'utf8'), previous);
        assert.equal(existsSync(tsv), false);
        if (kind === 'symlink') {
          assert.ok(lstatSync(report).isSymbolicLink());
          assert.equal(readFileSync(external, 'utf8'), previous);
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const kind of ['report', 'tsv', 'race', 'partial', 'success']) {
  test(`evaluation save preserves artifacts: ${kind}`, () => scenario(kind));
}
test('evaluation save refuses an existing report symlink', { skip: process.platform === 'win32' && 'file symlink requires privileges' }, () => scenario('symlink'));
