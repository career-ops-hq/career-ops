// #3162: the workspace root must survive a sibling test that legitimately sets
// CAREER_OPS_TRACKER for its own fixture. Before the fix, generate-pdf.mjs
// froze the root at import time, so an import landing inside that window
// anchored the containment guard to another test's temp directory for the rest
// of the process — the guard then refused valid repo paths, intermittently and
// only under the full suite (occurrence 6 of #3162 named the temp dir outright).
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ngenerate-pdf-workspace-root.test.mjs — the containment root is read at use time (#3162)');

const originalTracker = process.env.CAREER_OPS_TRACKER;
const originalRoot = process.env.CAREER_OPS_ROOT;
const originalDataDir = process.env.CAREER_OPS_DATA_DIR;
const foreign = mkdtempSync(join(tmpdir(), 'cops-foreign-'));
const alternate = mkdtempSync(join(tmpdir(), 'cops-alternate-root-'));
mkdirSync(join(foreign, 'output'), { recursive: true });
writeFileSync(join(foreign, 'applications.md'), '# Applications Tracker\n');
mkdirSync(join(alternate, 'data'), { recursive: true });
mkdirSync(join(alternate, 'output'), { recursive: true });
writeFileSync(join(alternate, 'data', 'applications.md'), '# Applications Tracker\n');

let failures = 0;
try {
  // Poison the environment the way a sibling fixture does, THEN import.
  process.env.CAREER_OPS_TRACKER = join(foreign, 'applications.md');
  const mod = await import('../generate-pdf.mjs');
  // Restore exactly as that sibling does in its finally.
  if (originalTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = originalTracker;

  // A path inside the real repo must be accepted now that the variable is back.
  const repoPath = join(ROOT, 'output', 'workspace-root-probe.html');
  try {
    const rel = mod.workspaceRelativeManifestPath(repoPath);
    if (typeof rel === 'string' && rel.length > 0 && !rel.startsWith('..')) {
      pass('a repo path resolves against the real workspace after a sibling restored CAREER_OPS_TRACKER');
    } else {
      fail(`repo path resolved to "${rel}" — the root is still anchored to the foreign fixture (#3162)`);
      failures++;
    }
  } catch (err) {
    fail(`repo path rejected after restore: ${err.message}`);
    failures++;
  }

  try {
    delete process.env.CAREER_OPS_TRACKER;
    delete process.env.CAREER_OPS_DATA_DIR;
    process.env.CAREER_OPS_ROOT = alternate;
    const canonicalAlternate = realpathSync(alternate);
    const rel = mod.workspaceRelativeManifestPath(join(canonicalAlternate, 'output', 'alternate-root-probe.html'));
    if (rel === 'output/alternate-root-probe.html') {
      pass('workspace cache refreshes when CAREER_OPS_ROOT changes after import');
    } else {
      fail(`alternate root resolved to "${rel}" — root cache ignored CAREER_OPS_ROOT`);
      failures++;
    }
  } catch (err) {
    fail(`alternate CAREER_OPS_ROOT path rejected after import: ${err.message}`);
    failures++;
  }
} finally {
  if (originalTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = originalTracker;
  if (originalRoot === undefined) delete process.env.CAREER_OPS_ROOT;
  else process.env.CAREER_OPS_ROOT = originalRoot;
  if (originalDataDir === undefined) delete process.env.CAREER_OPS_DATA_DIR;
  else process.env.CAREER_OPS_DATA_DIR = originalDataDir;
  rmSync(foreign, { recursive: true, force: true });
  rmSync(alternate, { recursive: true, force: true });
}

if (failures) process.exitCode = 1;
