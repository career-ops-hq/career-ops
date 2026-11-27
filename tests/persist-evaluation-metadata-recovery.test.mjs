import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

const payload = {
  num: '035', today: '2026-11-22', company: 'Globex', role: 'Analyst', score: '4.2/5',
  reportFile: '035-globex-2026-11-22.md', markdown: '# Evaluation\n', notes: '',
};

for (const failedArtifact of ['report', 'tsv']) {
  for (const replacement of [false, true]) {
    test(`metadata failure permits recovery without deleting another save (${failedArtifact}, replacement=${replacement})`, () => {
      const root = fs.mkdtempSync(join(tmpdir(), 'evaluation-metadata-'));
      const report = join(root, 'reports', payload.reportFile);
      const tsv = join(root, 'batch', 'tracker-additions', '035-globex.tsv');
      const failedPath = failedArtifact === 'report' ? report : tsv;
      const descriptors = new Map();
      let openCount = 0, closeCount = 0;
      try {
        const result = writeEvaluationArtifacts(root, payload, {
          ...fs,
          openSync(file, ...args) {
            const fd = fs.openSync(file, ...args);
            descriptors.set(fd, file);
            openCount++;
            return fd;
          },
          closeSync(fd) { closeCount++; fs.closeSync(fd); },
          fstatSync(fd, options) {
            if (String(descriptors.get(fd)).endsWith(failedArtifact === 'report' ? '.md' : '.tsv')) {
              if (replacement) {
                const next = failedPath + '.next';
                fs.writeFileSync(next, 'concurrent save\n');
                fs.renameSync(next, failedPath);
              }
              throw Object.assign(new Error('injected metadata failure'), { code: 'EIO' });
            }
            return fs.fstatSync(fd, options);
          },
        });
        assert.equal(result.ok, false);
        assert.match(result.error, /injected metadata failure/);
        assert.equal(openCount, closeCount, 'every descriptor is closed');
        for (const file of [report, tsv]) {
          if (file === failedPath && replacement) assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent save\n');
          else assert.equal(fs.existsSync(file), false, 'unpublished or owned artifacts must roll back');
        }
        assert.deepEqual(fs.readdirSync(join(root, 'reports')).sort(), replacement && failedArtifact === 'report' ? [payload.reportFile] : []);
        assert.deepEqual(fs.readdirSync(join(root, 'batch', 'tracker-additions')).sort(), replacement && failedArtifact === 'tsv' ? ['035-globex.tsv'] : []);
        if (!replacement) assert.equal(writeEvaluationArtifacts(root, payload).ok, true, 'retry is not blocked by an orphan');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

for (const failedArtifact of ['report', 'tsv']) {
  test(`failed exclusive publication rolls back cleanly (${failedArtifact})`, () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'evaluation-publication-'));
    try {
      const result = writeEvaluationArtifacts(root, payload, {
        ...fs,
        linkSync(source, destination) {
          if (String(destination).endsWith(failedArtifact === 'report' ? '.md' : '.tsv')) {
            throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' });
          }
          fs.linkSync(source, destination);
        },
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /hard links unavailable/);
      assert.deepEqual(fs.readdirSync(join(root, 'reports')), []);
      assert.deepEqual(fs.readdirSync(join(root, 'batch', 'tracker-additions')), []);
      assert.equal(writeEvaluationArtifacts(root, payload).ok, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
