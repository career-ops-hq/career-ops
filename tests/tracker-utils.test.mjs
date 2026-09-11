/**
 * Focused unit coverage for the shared tracker helpers.
 *
 * These helpers are consumed by several tracker writers, so the tests stay
 * on the current tracker-utils module rather than introducing a parallel
 * tracker-core abstraction that can drift from main.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  rebuildRow,
  normalizeCompany,
  cell,
  resolveTrackerPath,
  resolveWorkspaceRoot,
  resolveWorkspaceRootFor,
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

// Asserted on the sanitizer itself, never through a writer. cell() is the one
// chokepoint every tracker writer passes through — merge-tracker's buildRow for
// company/role/location/notes/url (and so the web, which dictates rows through
// the same merge path), set-status for its note. Testing a caller instead would
// leave the guard un-asserted the moment a new writer is added; testing the
// chokepoint means a new writer inherits it or bypasses cell() visibly.
test('cell strips invisible control characters (#3892)', () => {
  // The realistic path: a role title copied out of a rendered posting carries a
  // C0 byte. It is invisible in markdown, on GitHub and in the web dashboard,
  // and it shifts or truncates the positional `split('|')` parse downstream.
  assert.equal(cell('Senior\x01 Engineer'), 'Senior Engineer');
  assert.equal(cell('Head\x7f of Growth'), 'Head of Growth');
  assert.equal(cell('Zeta\x9dCorp'), 'ZetaCorp');
  assert.equal(cell('\x00\x1b'), '');

  // Deleted, not replaced with a space: the byte renders as nothing, so a
  // replacement would change the text a human already sees.
  assert.equal(cell('Data\x0cEngineer'), 'DataEngineer');

  // Whitespace that legitimately separates words is left alone — a tab is
  // ordinary whitespace in a cell, and a newline still folds to one space.
  assert.equal(cell('Staff\tEngineer'), 'Staff\tEngineer');
  assert.equal(cell('Acme\r\nRemote'), 'Acme Remote');
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

test('resolveWorkspaceRootFor keeps a symlinked data/ inside the repo (#3169)', () => {
  const parent = mkdtempSync(join(tmpdir(), 'career-ops-symlinked-data-'));
  const repo = join(parent, 'repo');
  const external = join(parent, 'external');
  const oldTracker = process.env.CAREER_OPS_TRACKER;
  try {
    delete process.env.CAREER_OPS_TRACKER;
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(external, 'data'), { recursive: true });
    writeFileSync(join(external, 'data', 'applications.md'), '# tracker\n');
    // The natural #524 workaround: symlink only data/ out of the repo.
    symlinkSync(join('..', 'external', 'data'), join(repo, 'data'));

    const canonicalRepo = realpathSync(repo);
    const canonicalExternal = realpathSync(external);

    // Deriving from the canonical tracker path realpaths through the symlink and
    // lands outside the repo: the #3169 bug.
    assert.equal(realpathSync(resolveWorkspaceRoot(resolveTrackerPath(repo))), canonicalExternal);

    // resolveWorkspaceRootFor derives from the uncanonicalized path and stays in
    // the repo, where cv.md and config/ actually live.
    assert.equal(realpathSync(resolveWorkspaceRootFor(repo)), canonicalRepo);
    assert.notEqual(realpathSync(resolveWorkspaceRootFor(repo)), canonicalExternal);

    // The derived root is already canonical, so a consumer's realpathSync stays a
    // no-op and lexical containment checks keep agreeing, even though mkdtemp sits
    // under a symlinked ancestor on macOS (/var -> /private/var). Guards #3191.
    const derived = resolveWorkspaceRootFor(repo);
    assert.equal(derived, realpathSync(derived));

    // #2471: an explicitly external CAREER_OPS_TRACKER still moves the whole set
    // together, so the workspace follows the env var out of the repo.
    process.env.CAREER_OPS_TRACKER = join(external, 'data', 'applications.md');
    assert.equal(realpathSync(resolveWorkspaceRootFor(repo)), canonicalExternal);
  } finally {
    if (oldTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
    else process.env.CAREER_OPS_TRACKER = oldTracker;
    rmSync(parent, { recursive: true, force: true });
  }
});
