import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

for (const field of ['dev', 'ino', 'birthtimeNs']) {
  test(`rollback preserves a replacement with a distinct exact ${field}`, () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'evaluation-exact-identity-'));
    const report = join(root, 'reports', '035-globex-2026-10-22.md');
    const descriptors = new Map();
    const identity = { dev: 9007199254740992n, ino: 9007199254740992n, birthtimeNs: 1700000000000000000n };
    let replaced = false;
    const metadata = (options, replacement = false) => {
      const values = { ...identity };
      if (replacement) values[field] += 1n;
      return {
        isFile: () => true,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, options?.bigint ? value : Number(value)])),
        birthtimeMs: options?.bigint ? values.birthtimeNs / 1000000n : Number(values.birthtimeNs) / 1000000,
      };
    };
    try {
      const result = writeEvaluationArtifacts(root, {
        num: '035', today: '2026-10-22', company: 'Globex', role: 'Analyst', score: '4.2/5',
        reportFile: '035-globex-2026-10-22.md', markdown: '# Evaluation\n', notes: '',
      }, {
        ...fs,
        openSync(file, ...args) {
          const fd = fs.openSync(file, ...args);
          descriptors.set(fd, file);
          return fd;
        },
        fstatSync(fd, options) { return metadata(options); },
        lstatSync(file, options) { return metadata(options, file === report && replaced); },
        writeFileSync(file, ...args) {
          if ((descriptors.get(file) || file).endsWith('.tsv')) {
            fs.writeFileSync(report, 'concurrent replacement\n');
            replaced = true;
            throw Object.assign(new Error('injected TSV failure'), { code: 'EIO' });
          }
          return fs.writeFileSync(file, ...args);
        },
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /injected TSV failure/);
      assert.equal(fs.readFileSync(report, 'utf8'), 'concurrent replacement\n');
      assert.equal(fs.existsSync(join(root, 'batch', 'tracker-additions', '035-globex.tsv')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
