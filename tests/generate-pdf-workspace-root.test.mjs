// #3162: the workspace root must survive a sibling test that legitimately sets
// CAREER_OPS_TRACKER for its own fixture. Before the fix, generate-pdf.mjs
// froze the root at import time, so an import landing inside that window
// anchored the containment guard to another test's temp directory for the rest
// of the process — the guard then refused valid repo paths, intermittently and
// only under the full suite (occurrence 6 of #3162 named the temp dir outright).
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ngenerate-pdf-workspace-root.test.mjs — the containment root is read at use time (#3162)');

const original = process.env.CAREER_OPS_TRACKER;
const foreign = mkdtempSync(join(tmpdir(), 'cops-foreign-'));
mkdirSync(join(foreign, 'output'), { recursive: true });
writeFileSync(join(foreign, 'applications.md'), '# Applications Tracker\n');

let failures = 0;
try {
  // Poison the environment the way a sibling fixture does, THEN import.
  process.env.CAREER_OPS_TRACKER = join(foreign, 'applications.md');
  const mod = await import('../generate-pdf.mjs');
  // Restore exactly as that sibling does in its finally.
  if (original === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = original;

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
} finally {
  if (original === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = original;
}

if (failures) process.exitCode = 1;
