import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

const payload = {
  num: '035', today: '2026-10-22', company: 'Globex', role: 'Analyst', score: '4.2/5',
  reportFile: '035-globex-2026-10-22.md', markdown: '# New evaluation\n', notes: 'synthetic fixture',
};

for (const kind of ['report', 'tsv', 'symlink']) {
  test(`failed evaluation save preserves a replacement ${kind}`, {
    skip: kind === 'symlink' && process.platform === 'win32' && 'file symlink requires privileges',
  }, () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'evaluation-rollback-'));
    const report = join(root, 'reports', payload.reportFile);
    const tsv = join(root, 'batch', 'tracker-additions', '035-globex.tsv');
    const external = join(root, 'other-application.md');
    const replacement = 'updated by a concurrent writer\n';
    const descriptors = new Map();
    let pendingReplacement;
    try {
      const result = writeEvaluationArtifacts(root, payload, {
        ...fs,
        openSync(file, ...args) {
          const fd = fs.openSync(file, ...args);
          descriptors.set(fd, file);
          return fd;
        },
        closeSync(fd) {
          fs.closeSync(fd);
          if (descriptors.get(fd) === tsv && pendingReplacement) {
            fs.renameSync(...pendingReplacement);
          }
        },
        writeFileSync(file, ...args) {
          if ((descriptors.get(file) || file) === tsv) {
            const target = kind === 'tsv' ? tsv : report;
            const temporary = target + '.next';
            if (kind === 'symlink') {
              fs.writeFileSync(external, replacement);
              fs.symlinkSync(external, temporary);
            } else {
              fs.writeFileSync(temporary, replacement);
            }
            if (typeof file === 'number') pendingReplacement = [temporary, target];
            else fs.renameSync(temporary, target);
            throw Object.assign(new Error('injected TSV write failure'), { code: 'EIO' });
          }
          return fs.writeFileSync(file, ...args);
        },
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /injected TSV write failure/);
      const retained = kind === 'tsv' ? tsv : report;
      assert.equal(fs.readFileSync(retained, 'utf8'), replacement);
      assert.equal(fs.existsSync(kind === 'tsv' ? report : tsv), false, 'owned artifacts still roll back');
      if (kind === 'symlink') {
        assert.ok(fs.lstatSync(report).isSymbolicLink());
        assert.equal(fs.readFileSync(external, 'utf8'), replacement);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
