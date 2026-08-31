// tests/scan-ats-full-data-root.test.mjs — Bug 5 regression: all four path
// constants in scan-ats-full.mjs must be anchored to the data root, not cwd.
//
// Imports the REAL scan-ats-full.mjs with CAREER_OPS_ROOT set before the
// dynamic import so the module-level constants are evaluated against a known
// temp root. Uses _testPaths — the minimal named export added to
// scan-ats-full.mjs to make the production-resolved paths inspectable without
// duplicating the resolution logic in the test.
//
// End-to-end checkpoint/resume behaviour is covered separately by
// scan-ats-full-outage-checkpoint.test.mjs; this test focuses on path
// anchoring and the CAREER_OPS_PORTALS override.
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — data-root path anchoring');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-ats-'));
try {
  // Set CAREER_OPS_ROOT BEFORE importing. The module-level constants
  // (DATA_ROOT, PORTALS_PATH, PIPELINE_PATH, CACHE_DIR, CHECKPOINT_PATH) are
  // evaluated once at import time, so the env must be in place before that.
  process.env.CAREER_OPS_ROOT = dir;

  // Minimal portals.yml — the module does not read it at import time, but
  // creating it now documents the expected layout under the temp root.
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - engineer\n');

  // Import the REAL scan-ats-full.mjs. The '?root=...' query busts the ESM
  // cache so the module is re-evaluated with the current CAREER_OPS_ROOT even
  // if an earlier test in the same test-all.mjs process already imported it
  // without that env var set (module-level constants are frozen at import time).
  const scanAtsUrl = pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href;
  const { _testPaths, loadCheckpoint } = await import(scanAtsUrl + '?root=' + Date.now());

  // --- Bug 5: all path constants must be rooted in DATA_ROOT ---

  if (_testPaths.PORTALS_PATH === join(dir, 'portals.yml')) {
    pass('PORTALS_PATH anchored to configured data root');
  } else {
    fail(`PORTALS_PATH wrong: expected ${join(dir, 'portals.yml')}, got ${_testPaths.PORTALS_PATH}`);
  }

  if (_testPaths.PIPELINE_PATH === join(dir, 'data', 'pipeline.md')) {
    pass('PIPELINE_PATH anchored to configured data root');
  } else {
    fail(`PIPELINE_PATH wrong: expected ${join(dir, 'data', 'pipeline.md')}, got ${_testPaths.PIPELINE_PATH}`);
  }

  if (_testPaths.CACHE_DIR === join(dir, 'data', 'cache', 'ats-companies')) {
    pass('CACHE_DIR anchored to configured data root');
  } else {
    fail(`CACHE_DIR wrong: expected ${join(dir, 'data', 'cache', 'ats-companies')}, got ${_testPaths.CACHE_DIR}`);
  }

  if (_testPaths.CHECKPOINT_PATH === join(dir, 'data', 'cache', 'ats-full-checkpoint.json')) {
    pass('CHECKPOINT_PATH anchored to configured data root');
  } else {
    fail(`CHECKPOINT_PATH wrong: expected ${join(dir, 'data', 'cache', 'ats-full-checkpoint.json')}, got ${_testPaths.CHECKPOINT_PATH}`);
  }

  // --- CAREER_OPS_PORTALS override must win over the data-root default ---
  // Re-import with a cache-busting query so the module is re-evaluated with the
  // new env value. (ESM modules are cached by URL; the query param produces a
  // distinct cache entry, triggering a fresh evaluation with the current env.)
  {
    const customPortals = join(dir, 'custom-portals.yml');
    process.env.CAREER_OPS_PORTALS = customPortals;
    try {
      const { _testPaths: t2 } = await import(scanAtsUrl + '?portals=' + Date.now());
      if (t2.PORTALS_PATH === customPortals) {
        pass('CAREER_OPS_PORTALS override respected over data-root default');
      } else {
        fail(`PORTALS_PATH override wrong: expected ${customPortals}, got ${t2.PORTALS_PATH}`);
      }
    } finally {
      delete process.env.CAREER_OPS_PORTALS;
    }
  }

  // --- loadCheckpoint returns null for a missing file (real exported function) ---
  const absent = join(dir, 'no-such-checkpoint.json');
  const cp = loadCheckpoint(absent);
  if (cp === null) {
    pass('loadCheckpoint returns null for a missing file');
  } else {
    fail(`loadCheckpoint returned ${JSON.stringify(cp)} for a missing file`);
  }

} finally {
  delete process.env.CAREER_OPS_ROOT;
  rmSync(dir, { recursive: true, force: true });
}
