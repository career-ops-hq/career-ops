// tests/plugins-data-root.test.mjs — Bugs 2 & 3 regression:
//   Bug 2: plugins.mjs must derive APPLICATIONS_PATH and PIPELINE_PATH from
//     the data root (CAREER_OPS_ROOT), not from the code directory.
//   Bug 3: buildSnapshot() must parse pipeline.md checklist entries, not a table.
//
// Imports the REAL plugins.mjs with CAREER_OPS_ROOT set before the dynamic
// import so the module-level constants are evaluated against the temp root.
// Uses _testPaths and _testBuildSnapshot — the minimal named exports added to
// plugins.mjs to make its internal constants and snapshot function inspectable
// without duplicating path-resolution logic in the test.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nplugins — data-root path resolution and buildSnapshot pipeline parser');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-plugins-'));
try {
  // Set CAREER_OPS_ROOT BEFORE importing plugins.mjs. The module-level
  // constants DATA_ROOT / APPLICATIONS_PATH / PIPELINE_PATH are evaluated
  // once at import time, so the env must be in place before that happens.
  process.env.CAREER_OPS_ROOT = dir;

  // Write a real pipeline.md with checklist entries so buildSnapshot() reads
  // real content. scan.mjs (imported transitively by plugins.mjs) also calls
  // mkdirSync on data/, but runs after this and is idempotent.
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(
    join(dir, 'data', 'pipeline.md'),
    '# Pipeline\n- [ ] https://example.com/job/1\n- [x] https://example.com/job/2\n',
  );

  // Import the REAL plugins.mjs. The '?root=...' query busts the ESM cache so
  // the module is re-evaluated with the current CAREER_OPS_ROOT even if an
  // earlier test in the same test-all.mjs process already imported it (or a
  // module that transitively imports it) without that env var set.
  const { _testPaths, _testBuildSnapshot } = await import(
    pathToFileURL(join(ROOT, 'plugins.mjs')).href + '?root=' + Date.now()
  );

  // --- Bug 2: APPLICATIONS_PATH and PIPELINE_PATH must be rooted in DATA_ROOT ---

  const expectedApps = join(dir, 'data', 'applications.md');
  if (_testPaths.APPLICATIONS_PATH === expectedApps) {
    pass('APPLICATIONS_PATH anchored to configured data root');
  } else {
    fail(`APPLICATIONS_PATH wrong: expected ${expectedApps}, got ${_testPaths.APPLICATIONS_PATH}`);
  }

  const expectedPipeline = join(dir, 'data', 'pipeline.md');
  if (_testPaths.PIPELINE_PATH === expectedPipeline) {
    pass('PIPELINE_PATH anchored to configured data root');
  } else {
    fail(`PIPELINE_PATH wrong: expected ${expectedPipeline}, got ${_testPaths.PIPELINE_PATH}`);
  }

  // --- Bug 3: buildSnapshot() must use the checklist regex, not parseMarkdownTable ---

  // Call the REAL buildSnapshot() — it reads from PIPELINE_PATH (the file we
  // wrote above) using the production checklist regex. The old implementation
  // called parseMarkdownTable() on pipeline.md, which would return [] because
  // the file contains no table rows. With the fix it returns both entries.
  const snap = _testBuildSnapshot();
  const urls = snap.pipeline.map(e => e.url);

  if (urls.length === 2) {
    pass(`buildSnapshot() reads ${urls.length} checklist entries from the real pipeline.md`);
  } else {
    fail(`buildSnapshot() returned ${urls.length} entries, expected 2 — the old parseMarkdownTable() would return 0`);
  }

  if (urls[0] === 'https://example.com/job/1' && urls[1] === 'https://example.com/job/2') {
    pass('buildSnapshot() URLs match the checklist content at the configured data root');
  } else {
    fail(`buildSnapshot() URLs: ${JSON.stringify(urls)}`);
  }

} finally {
  delete process.env.CAREER_OPS_ROOT;
  rmSync(dir, { recursive: true, force: true });
}
