import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateApplyReport } from '../apply-scope.mjs';

test('locateApplyReport matches the report number, not a longer prefix', () => {
  const root = mkdtempSync(join(tmpdir(), 'apply-report-number-'));
  try {
    mkdirSync(join(root, 'reports'));
    const io = {
      exists: () => false,
      list: () => ['1000-globex.md', '100-acme.md', '64-northwind.md'],
    };
    const hundred = locateApplyReport(root, '100', io);
    assert.equal(hundred.ok, true);
    assert.equal(hundred.path, join(root, 'reports', '100-acme.md'));

    const onlyLonger = locateApplyReport(root, '100', {
      exists: () => false,
      list: () => ['1000-globex.md'],
    });
    assert.deepEqual(onlyLonger, { ok: false, reason: 'missing' });

    const unpadded = locateApplyReport(root, '64', io);
    assert.equal(unpadded.ok, true);
    assert.equal(unpadded.path, join(root, 'reports', '64-northwind.md'));

    const padded = locateApplyReport(root, '1', {
      exists: () => false,
      list: () => ['001-acme.md'],
    });
    assert.equal(padded.ok, true);
    assert.equal(padded.path, join(root, 'reports', '001-acme.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
