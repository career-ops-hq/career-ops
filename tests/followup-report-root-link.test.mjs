import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReportPath } from '../followup-cadence.mjs';

// Writers emit `(reports/file.md)` from the repo root. merge-tracker later
// rewrites that to `../reports/file.md` beside data/applications.md. Cadence
// only resolved the rewritten shape, so reportPath was null until migrate.

test('a root-relative reports link resolves, and a .. link cannot leave reports/', () => {
  const root = mkdtempSync(join(tmpdir(), 'fr-report-link-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'reports'));
    const name = '012-acme-2026-01-04.md';
    writeFileSync(join(root, 'reports', name), '# fixture\n');
    const apps = join(root, 'data', 'applications.md');
    assert.equal(resolveReportPath(`[12](reports/${name})`, apps, root), `reports/${name}`);
    assert.equal(resolveReportPath(`[12](../reports/${name})`, apps, root), `reports/${name}`);
    assert.equal(resolveReportPath('[99](reports/../../outside.md)', apps, root), null);
    assert.equal(resolveReportPath('[99](../../outside.md)', apps, root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
