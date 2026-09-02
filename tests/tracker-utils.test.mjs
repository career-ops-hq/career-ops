/**
 * Focused unit coverage for the shared tracker helpers.
 *
 * These helpers are consumed by several tracker writers, so the tests stay
 * on the current tracker-utils module rather than introducing a parallel
 * tracker-core abstraction that can drift from main.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  rebuildRow,
  normalizeCompany,
  cell,
  resolveTrackerPath,
  resolveWorkspaceRoot,
  resolvePdfIndexPath,
  loadCanonicalStates,
  foldStatusInput,
  resolveCanonicalState,
} from '../tracker-utils.mjs';

test('rebuildRow preserves the final cell with or without a trailing pipe', () => {
  assert.equal(rebuildRow(['', '7', 'Acme', 'great note']), '| 7 | Acme | great note |');
  assert.equal(rebuildRow(['', '7', 'Acme', 'great note', '']), '| 7 | Acme | great note |');
  assert.equal(rebuildRow(['', '7', 'Acme', 'remote', 'great note', '']), '| 7 | Acme | remote | great note |');
});

test('cell neutralizes table-breaking characters without changing ordinary text', () => {
  assert.equal(cell(' Acme | Remote\nline '), 'Acme / Remote line');
  assert.equal(cell(null), '');
  assert.equal(cell('Senior Engineer'), 'Senior Engineer');
});

test('normalizeCompany preserves meaningful non-Latin company names', () => {
  assert.equal(normalizeCompany('Acme, Inc. (Remote)'), 'acmeincremote');
  assert.equal(normalizeCompany('株式会社ゼータ'), '株式会社ゼータ');
  assert.notEqual(normalizeCompany('株式会社ゼータ'), normalizeCompany('合同会社オメガ'));
});

test('tracker paths follow the workspace selected by the tracker', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-tracker-utils-'));
  const oldTracker = process.env.CAREER_OPS_TRACKER;
  const oldPdfIndex = process.env.CAREER_OPS_PDF_INDEX;
  try {
    delete process.env.CAREER_OPS_TRACKER;
    delete process.env.CAREER_OPS_PDF_INDEX;
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'applications.md'), '# tracker\n');
    const tracker = resolveTrackerPath(root);
    const canonicalRoot = realpathSync(root);
    assert.equal(resolveWorkspaceRoot(tracker), canonicalRoot);
    assert.equal(resolvePdfIndexPath(tracker), join(canonicalRoot, 'data', 'pdf-index.tsv'));

    const alternate = join(root, 'custom-applications.md');
    process.env.CAREER_OPS_TRACKER = alternate;
    assert.equal(resolveTrackerPath(root), alternate);
  } finally {
    if (oldTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
    else process.env.CAREER_OPS_TRACKER = oldTracker;
    if (oldPdfIndex === undefined) delete process.env.CAREER_OPS_PDF_INDEX;
    else process.env.CAREER_OPS_PDF_INDEX = oldPdfIndex;
    rmSync(root, { recursive: true, force: true });
  }
});

test('status input resolves through the canonical states file', () => {
  const states = loadCanonicalStates(fileURLToPath(new URL('../templates/states.yml', import.meta.url)));
  assert.equal(foldStatusInput(' **TEKLİF** '), 'teklif');
  assert.equal(resolveCanonicalState('**aplicado**', states), 'Applied');
  assert.equal(resolveCanonicalState('TEKLİF', states), 'Offer');
  assert.equal(resolveCanonicalState('not-a-state', states), null);
});
