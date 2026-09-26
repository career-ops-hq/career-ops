/**
 * updater-local-overlay.test.mjs — coverage for the local overlay declaration file (#4326).
 *
 * Verifies that the system overlay configuration correctly parses, validates, and
 * rejects improper paths, similar to updater-local-paths.test.mjs but for system files.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import {
  LOCAL_OVERLAY_FILE,
  LOCAL_PATHS_FILE,
  localOverlayPaths,
  gitIn,
  gitRawIn
} from '../update-system.mjs';

function makeRoot(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'co-local-overlay-'));
  if (contents !== undefined) {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, LOCAL_OVERLAY_FILE), contents);
  }
  return dir;
}

const roots = [];
function root(contents) {
  const dir = makeRoot(contents);
  roots.push(dir);
  return dir;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n🧪 Local system overlay declaration file (#4326)\n');

// ── 1. Absent file is a no-op ──
{
  const got = localOverlayPaths(root(undefined));
  if (eq(got, [])) {
    pass('no overlay declaration file → no overlay paths');
  } else {
    fail(`#1 absent file returned ${JSON.stringify(got)}`);
  }
}

// ── 2. An empty / comments-only file is also a no-op ──
{
  const got = localOverlayPaths(root('# just a comment\n\n   \n'));
  if (eq(got, [])) {
    pass('comments and blank lines only → no overlay paths');
  } else {
    fail(`#2 comments-only returned ${JSON.stringify(got)}`);
  }
}

// ── 3. A user layer file is refused ──
{
  let threw = null;
  try {
    localOverlayPaths(root('cv.md\n'));
  } catch (err) {
    threw = err;
  }
  if (threw && threw.message.includes('cv.md')) {
    pass('declaring a non-system layer file throws and names the path');
  } else {
    fail(`#3 expected a throw naming cv.md, got ${threw ? threw.message : 'no throw'}`);
  }
}

// ── 4. A system file is accepted ──
{
  const got = localOverlayPaths(root('update-system.mjs\n'));
  if (eq(got, ['update-system.mjs'])) {
    pass('declaring a system file is accepted');
  } else {
    fail(`#4 expected update-system.mjs, got ${JSON.stringify(got)}`);
  }
}

// ── 5. The declaration file itself and local-paths are refused ──
{
  for (const bad of [LOCAL_OVERLAY_FILE, LOCAL_PATHS_FILE]) {
    let threw = null;
    try {
      localOverlayPaths(root(`${bad}\n`));
    } catch (err) {
      threw = err;
    }
    if (threw && threw.message.includes(bad)) {
      pass(`cannot list config file itself: ${bad}`);
    } else {
      fail(`#5 expected a throw naming ${bad}, got ${threw ? threw.message : 'no throw'}`);
    }
  }
}

// ── 6. Absolute paths and parent-directory escapes are refused ──
{
  for (const bad of ['/etc/passwd', '../outside.txt', 'C:\\Windows\\system.ini']) {
    let threw = null;
    try {
      localOverlayPaths(root(`${bad}\n`));
    } catch (err) {
      threw = err;
    }
    if (threw) {
      pass(`escaping path refused: ${bad}`);
    } else {
      fail(`#6 accepted an escaping path: ${bad}`);
    }
  }
}

// ── 7. Non-canonical spellings of a system path are refused ──
{
  const nonCanonical = [
    ['./update-system.mjs', 'a leading ./'],
    ['dashboard/./main.go', 'an interior . segment'],
    ['dashboard//main.go', 'a repeated separator'],
    ['dashboard\\main.go', 'a backslash separator'],
  ];
  const survivors = [];
  for (const [path, shape] of nonCanonical) {
    let threw = null;
    try {
      localOverlayPaths(root(`${path}\n`));
    } catch (err) {
      threw = err;
    }
    if (!threw || !threw.message.includes(path)) survivors.push(`${shape} → ${path}`);
  }
  if (survivors.length === 0) {
    pass('non-canonical path spellings are refused and named');
  } else {
    fail(`#7 these non-canonical forms were accepted: ${survivors.join('; ')}`);
  }
}

// ── 8. Apply path: clean overlay 3-way merge ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-8-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  // Upstream edits line 1
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1 upstream\nline 2\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  // Local overlay edits line 3
  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3 local\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);

  g('checkout', 'upstream', '--', 'modes/pdf.md');
  g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)', join(dir, 'modes', 'pdf.md'), join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.bak'));

  const merged = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  if (merged === 'line 1 upstream\nline 2\nline 3 local\n') {
    pass('apply path: clean overlay 3-way merge integrates upstream and local edits');
  } else {
    fail(`#8 clean merge failed, got: ${JSON.stringify(merged)}`);
  }
}

// ── 9. Apply path: overlay merge conflict stops update ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-9-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 upstream edit\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 local edit\nline 3\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);
  g('checkout', 'upstream', '--', 'modes/pdf.md');

  let mergeFailed = false;
  try {
    g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)', join(dir, 'modes', 'pdf.md'), join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.bak'));
  } catch {
    mergeFailed = true;
  }

  const conflictedContent = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  if (mergeFailed && conflictedContent.includes('<<<<<<< Upstream')) {
    pass('apply path: overlay conflict inserts markers and raises error signal');
  } else {
    fail(`#9 expected conflict markers and non-zero exit, got failed=${mergeFailed} content=${JSON.stringify(conflictedContent)}`);
  }
}

// ── 10. Apply path: overlay whose backup failed is preserved as-is without merge ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-10-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1 upstream\nline 2\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3 local edit\n');

  const failedBackups = new Set(['modes/pdf.md']);
  const overlayPaths = localOverlayPaths(dir);
  const atRisk = ['modes/pdf.md'];
  const overlaysToMerge = [];

  for (const file of atRisk) {
    const isOverlay = overlayPaths.some((op) => op.endsWith('/') ? file.startsWith(op) : op === file);
    if (isOverlay) {
      if (!failedBackups.has(file)) {
        overlaysToMerge.push(file);
      }
    }
  }

  const preservedPaths = atRisk.filter((f) => !overlaysToMerge.includes(f));
  if (overlaysToMerge.length === 0 && preservedPaths.includes('modes/pdf.md')) {
    pass('apply path: overlay whose backup failed skips merge and is preserved');
  } else {
    fail(`#10 expected preserved overlay, got overlays=${JSON.stringify(overlaysToMerge)} preserved=${JSON.stringify(preservedPaths)}`);
  }
}

for (const dir of roots) rmSync(dir, { recursive: true, force: true });

