// tests/providers-dir-code-root.test.mjs — system-layer paths resolve from the
// CODEBASE, never from the data root.
//
// providers/ and the project CLI configs are system layer (DATA_CONTRACT.md):
// they ship with the checkout and never travel to a user's data root. Three
// scripts anchored them to getCareerOpsRoot() anyway, so with CAREER_OPS_ROOT
// (or a .career-ops-data marker) pointing outside the checkout they read
// directories that do not exist:
//
//   - verify-pipeline.mjs loaded an EMPTY provider registry and warned "no
//     provider claims its careers_url — scan.mjs skips it on every run" for
//     entries scan.mjs scans correctly. scan.mjs anchors PROVIDERS_DIR to
//     CODE_ROOT and was never affected, so the advice was actionable and wrong.
//   - audit-portals.mjs — the script whose whole job is catching that exact
//     silent-skip state — reported "0 audited" and exited 0.
//   - doctor.mjs looked for .mcp.json beside the user's cv.md and reported a
//     correctly-configured Playwright MCP server as missing. The inverse was
//     worse: a stray copy in the data directory, which no CLI reads, reported
//     as configured.
//
// All three are invisible on the default layout, where the data root and the
// codebase are the same directory. The regression only appears once they
// diverge, which is why this test forces them apart.
import { pass, fail, run, lastRunFailure, formatRunFailure, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
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

  // ── doctor: project CLI config is codebase-relative too ──
  // .mcp.json is read by the CLI from the checkout it launches in, so a server
  // configured there must be seen even when the data root is elsewhere. The
  // inverse mattered just as much: a stray copy beside the user's cv.md, which
  // no CLI ever reads, used to report as configured.
  const mcpJson = JSON.stringify({
    mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  });
  const repoMcp = join(ROOT, '.mcp.json');
  const hadRepoMcp = existsSync(repoMcp);
  const savedRepoMcp = hadRepoMcp ? readFileSync(repoMcp, 'utf-8') : null;

  try {
    writeFileSync(repoMcp, mcpJson);
    const seen = run(NODE, [join(ROOT, 'doctor.mjs'), '--json'], { env });
    const parsed = seen ? JSON.parse(seen) : null;
    if (parsed?.playwright_mcp?.claude === true) {
      pass('doctor.mjs reads .mcp.json from the codebase under CAREER_OPS_ROOT');
    } else {
      fail('doctor.mjs missed a .mcp.json in the checkout — it followed the data root');
    }
  } finally {
    if (hadRepoMcp) writeFileSync(repoMcp, savedRepoMcp);
    else rmSync(repoMcp, { force: true });
  }
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
