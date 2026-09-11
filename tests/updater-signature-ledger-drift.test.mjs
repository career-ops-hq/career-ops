/**
 * updater-signature-ledger-drift.test.mjs — a new manifesto signature must not
 * read as system drift on every install (#4062).
 *
 * SIGNATURES.md is an append-only ledger of who signed MANIFESTO.md. It used
 * to sit in SYSTEM_PATHS, which put it inside the pathspec check() diffs:
 *
 *   systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD')
 *     → git diff --quiet --ignore-cr-at-eol FETCH_HEAD HEAD -- <SYSTEM_PATHS>
 *     → any one pathspec differing ⇒ reason: 'system-files-changed'
 *
 * The ledger takes dozens of commits a month while the code it ships beside
 * does not, so the moment anyone signed, every install on the planet started
 * reporting `update-available / system-files-changed` — the same permanent
 * false positive as #3149, from a third independent cause (after the SHA-vs-
 * content bug of #2630 and the ignore-rule route of #2756).
 *
 * These tests drive the REAL manifest — read out of update-system.mjs with
 * extractArrayFromSource, never a hard-coded copy — against throwaway repos
 * through the same ctx.git seam production uses. Hard-coding the path list
 * here would pin the fixture instead of the shipped behaviour, and the
 * regression would come back the first time someone re-added the entry.
 *
 *   - upstream appends a signature, nothing else moves → NOT drift
 *   - upstream edits a genuine system file             → still drift
 *     (the fix must narrow the pathspec, not blunt the check)
 */

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import { gitIn, systemTreeDiffers, extractArrayFromSource } from '../update-system.mjs';

const SIGNATURES = 'SIGNATURES.md';
// A second real system file, used as the control: whatever the manifest says
// today, an upstream change to THIS one must still report drift.
const CONTROL = 'MANIFESTO.md';
const USER_PATH = 'data/applications.md';

const realSystemPaths = extractArrayFromSource(
  readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8'),
  'SYSTEM_PATHS',
);

function seed(dir, path, body) {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

function makeOrigin() {
  const dir = mkdtempSync(join(tmpdir(), 'co-sig-origin-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.autocrlf', 'false');
  g('config', 'commit.gpgsign', 'false');
  seed(dir, SIGNATURES, '# Signatures\n\n- @first\n');
  seed(dir, CONTROL, '# Manifesto\n\nv1\n');
  seed(dir, USER_PATH, '| base | Acme | Intern |\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  return { dir, g };
}

function cloneInstall(originDir) {
  const dir = mkdtempSync(join(tmpdir(), 'co-sig-install-'));
  gitIn(dir, 'clone', '-q', originDir, '.');
  const g = (...args) => gitIn(dir, ...args);
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.autocrlf', 'false');
  g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

console.log('\n🧪 Testing signature-ledger drift (#4062)...');

// ── 0. Fixture preconditions ────────────────────────────────────────────────
// The two tests below are only meaningful if the real manifest is what it
// claims to be: non-empty, and still shipping the control file.
if (realSystemPaths.length > 0 && realSystemPaths.includes(CONTROL)) {
  pass(`real SYSTEM_PATHS read from update-system.mjs (${realSystemPaths.length} entries, includes ${CONTROL})`);
} else {
  fail(`could not read a usable SYSTEM_PATHS from update-system.mjs (${realSystemPaths.length} entries)`);
}

// ── 1. THE REGRESSION ───────────────────────────────────────────────────────
// Someone signs the manifesto upstream. Nothing an install runs has changed.
// check() must not call that system-files-changed.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    appendFileSync(join(origin.dir, SIGNATURES), '- @second\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'docs(signatures): add @second');

    install.g('fetch', '-q', origin.dir, 'main');

    // Fixture guard: the ledger really did diverge between the two refs.
    const changed = install.g('diff', '--name-only', 'FETCH_HEAD', 'HEAD').split('\n').filter(Boolean);
    if (changed.length === 1 && changed[0] === SIGNATURES) {
      pass(`fixture: ${SIGNATURES} is the only file differing from upstream`);
    } else {
      fail(`fixture: expected only ${SIGNATURES} to differ, got [${changed.join(', ')}]`);
    }

    const drift = systemTreeDiffers(realSystemPaths, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) });
    if (drift === false) {
      pass('a new signature alone is NOT system drift');
    } else {
      fail('a new signature alone reported as system drift — #4062 is back');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 2. The check still works ────────────────────────────────────────────────
// Narrowing the pathspec must not cost real drift detection: an upstream
// change to a genuine system file still has to report.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    writeFileSync(join(origin.dir, CONTROL), '# Manifesto\n\nv2\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'docs: revise manifesto');

    install.g('fetch', '-q', origin.dir, 'main');

    const drift = systemTreeDiffers(realSystemPaths, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) });
    if (drift === true) {
      pass(`an upstream change to ${CONTROL} still reports drift`);
    } else {
      fail(`an upstream change to ${CONTROL} read as no-drift — the check was blunted, not narrowed`);
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}
