// tests/providers-dir-code-root.test.mjs — providers/ resolves from the CODEBASE,
// never from the data root.
//
// providers/ is system layer (DATA_CONTRACT.md): it ships with the checkout and
// never travels to a user's data root. Two scripts anchored it to
// getCareerOpsRoot() anyway, so with CAREER_OPS_ROOT (or a .career-ops-data
// marker) pointing anywhere outside the checkout, loadProviders() read a
// directory that does not exist, returned an EMPTY registry, and every enabled
// portals.yml entry was then reported as claimed by no provider:
//
//   - verify-pipeline.mjs warned "no provider claims its careers_url —
//     scan.mjs skips it on every run" for entries scan.mjs scans correctly,
//     because scan.mjs anchors PROVIDERS_DIR to CODE_ROOT and was never
//     affected. The advice was actionable and wrong.
//   - audit-portals.mjs — the script whose whole job is catching that exact
//     silent-skip state — reported "0 audited" and exited 0.
//
// Both failures are invisible on the default layout, where the data root and
// the codebase are the same directory. The regression only appears once they
// diverge, which is why this test forces them apart.
import { pass, fail, run, lastRunFailure, formatRunFailure, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nproviders/ resolves from the codebase, not the data root');

// A data root that is emphatically NOT the checkout, and has no providers/ of
// its own — the shape every CAREER_OPS_ROOT user has.
const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-data-root-'));

try {
  mkdirSync(join(dataRoot, 'data'), { recursive: true });

  // One entry, a careers_url the shipped greenhouse provider claims via detect().
  // No `provider:` key: the explicit-provider path short-circuits detect() and
  // would still pass against an empty registry's `unknown provider` branch, so
  // it would not exercise the bug.
  writeFileSync(join(dataRoot, 'portals.yml'), [
    'job_boards:',
    '  - name: Test Greenhouse Board',
    '    careers_url: https://job-boards.greenhouse.io/example',
    '    enabled: true',
    'tracked_companies: []',
    '',
  ].join('\n'));

  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '',
  ].join('\n'));

  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };

  // ── verify-pipeline: the entry must resolve, not warn ──
  const out = run(NODE, [join(ROOT, 'verify-pipeline.mjs')], { env });
  if (out === null) {
    fail(`verify-pipeline.mjs crashed against an external data root${formatRunFailure(lastRunFailure())}`);
  } else if (/no provider claims/.test(out)) {
    fail('verify-pipeline.mjs loaded providers/ from the data root — a claimed entry was reported unclaimed');
  } else if (/resolve to a provider/.test(out)) {
    pass('verify-pipeline.mjs resolves providers/ from the codebase under CAREER_OPS_ROOT');
  } else {
    fail(`verify-pipeline.mjs produced no provider-resolution verdict:\n${out}`);
  }

  // ── audit-portals: assert the resolved path, not a run ──
  // Its only auditable input is tracked_companies, and auditing one entry
  // fetches that company's board — so the end-to-end assertion would either be
  // vacuous (empty tracked_companies audits nothing and passes whatever the
  // registry did) or network-bound. The resolved directory is the thing the bug
  // got wrong, so read it directly, in a child process that has already seen
  // CAREER_OPS_ROOT at import time.
  // The module URL rides in an env var, not argv: under `node -e` the first
  // extra argument lands in argv[1], which is precisely what isMainModule()
  // compares against — passing it there makes the child execute the whole CLI
  // instead of importing it.
  const printDir = 'import(process.env.TARGET_MODULE).then(m => console.log(m.PROVIDERS_DIR));';
  const resolved = run(NODE, ['-e', printDir], {
    env: { ...env, TARGET_MODULE: pathToFileURL(join(ROOT, 'audit-portals.mjs')).href },
  });
  if (resolved === null) {
    fail(`audit-portals.mjs failed to import under an external data root${formatRunFailure(lastRunFailure())}`);
  } else if (resolved === join(ROOT, 'providers')) {
    pass('audit-portals.mjs resolves providers/ from the codebase under CAREER_OPS_ROOT');
  } else {
    fail(`audit-portals.mjs PROVIDERS_DIR followed the data root: ${resolved}`);
  }
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
