// The user-layer data root is resolved through path-resolver.mjs: the
// CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR variables, then a `.career-ops-data`
// marker next to the scripts, then the script directory itself (AGENTS.md,
// "Path Resolution Override & Precedence"). A git worktree is the layout that
// exercises the marker for real: the scripts run from a checkout that holds no
// cv.md, no config/ and no data/, and the marker points at the checkout that
// does. Two scripts honoured that contract at import time and broke it at use
// time:
//
//   - generate-pdf.mjs derived its containment root from its own directory in
//     the use-time re-derivation added for #3162, so every DATA_ROOT-relative
//     input was refused as "escaping the tracker workspace";
//   - verify-cv-facts.mjs resolved its default sources against process.cwd(),
//     read an empty cv.md from the worktree, and failed every real number in
//     the generated CV as "absent from sources".
//
// Both are driven here as spawned CLIs from a worktree-shaped sandbox with the
// three environment overrides stripped, so the marker is the only signal — the
// exact situation the `pdf` mode runs in from a worktree.
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, rmSync, linkRepoPackage, ROOT, NODE } from './helpers.mjs';

console.log('\ndata-root-marker-worktree.test.mjs — scripts run from a worktree honour the .career-ops-data marker');

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
// realpathSync on both: Node resolves import.meta.url from a file's REALPATH
// while argv keeps the caller's spelling, and generate-pdf's isMain guard
// compares the two (#3165). The data root is compared canonically by the
// containment guard, so its expected spelling must be canonical as well.
const worktree = realpathSync(mkdtempSync(join(outputRoot, 'marker-worktree-')));
const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-marker-data-')));

const ENV_OVERRIDES = ['CAREER_OPS_TRACKER', 'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PDF_INDEX'];
const cleanEnv = { ...process.env };
for (const name of ENV_OVERRIDES) delete cleanEnv[name];

function runScript(script, args) {
  const result = spawnSync(NODE, [join(worktree, script), ...args], {
    cwd: worktree,
    env: cleanEnv,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

try {
  // ── The worktree: scripts + marker, and nothing user-layer ─────────────
  for (const file of [
    'generate-pdf.mjs', 'verify-cv-facts.mjs', 'theme-style.mjs', 'tracker-utils.mjs',
    'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs', 'path-resolver.mjs',
  ]) {
    copyFileSync(join(ROOT, file), join(worktree, file));
  }
  mkdirSync(join(worktree, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib', 'is-main-module.mjs'), join(worktree, 'lib', 'is-main-module.mjs'));
  linkRepoPackage(worktree, 'js-yaml');
  writeFileSync(join(worktree, '.career-ops-data'), `${dataRoot}\n`, 'utf-8');

  // Chromium stand-in: a one-page PDF whose page tree generate-pdf can count.
  const playwrightStub = join(worktree, 'node_modules', 'playwright');
  mkdirSync(playwrightStub, { recursive: true });
  writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
    name: 'playwright', type: 'module', exports: './index.js',
  }), 'utf-8');
  writeFileSync(join(playwrightStub, 'index.js'), `
const ONE_PAGE = Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');
const page = { async goto() {}, async evaluate() {}, async pdf() { return ONE_PAGE; }, async close() {} };
export const chromium = {
  async launch() {
    return {
      async newContext() { return { async newPage() { return page; }, async close() {} }; },
      async newPage() { return page; },
      async close() {},
    };
  },
};
`, 'utf-8');

  // ── The data root: everything the contract says lives there ────────────
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'config'), { recursive: true });
  mkdirSync(join(dataRoot, 'output'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'),
    '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n', 'utf-8');
  writeFileSync(join(dataRoot, 'data', 'pdf-index.tsv'), '', 'utf-8');
  writeFileSync(join(dataRoot, 'cv.md'), [
    '# Jane Doe',
    '',
    '## Summary',
    'Senior engineer with 6 years of experience.',
    '',
    '## Experience',
    'Cut p95 latency 20% for 40 services.',
    '',
  ].join('\n'), 'utf-8');
  writeFileSync(join(dataRoot, 'config', 'cv-facts.json'), JSON.stringify({
    allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [],
  }), 'utf-8');
  const html = join(dataRoot, 'output', 'cv-probe.html');
  writeFileSync(html, [
    '<html><body>',
    '<h2>Summary</h2><p>Senior engineer with 6 years of experience.</p>',
    '<h2>Experience</h2><p>Cut p95 latency 20% for 40 services.</p>',
    '</body></html>',
  ].join('\n'), 'utf-8');

  // ── generate-pdf.mjs ───────────────────────────────────────────────────
  const pdf = join(dataRoot, 'output', 'cv-probe.pdf');
  const render = runScript('generate-pdf.mjs', [html, pdf, '--format=letter']);
  if (render.status === 0 && existsSync(pdf) && !render.output.includes('outside the tracker workspace')) {
    pass('generate-pdf.mjs renders a DATA_ROOT input to a DATA_ROOT output from a marker-bearing worktree');
  } else {
    fail(`generate-pdf.mjs refused DATA_ROOT paths from a marker-bearing worktree (exit ${render.status}):\n${render.output.trim()}`);
  }

  // The inverse pins WHICH root the guard is anchored to. A file inside the
  // worktree is outside the data root, so it must be refused; the defective
  // guard, anchored to the script directory, accepted it.
  const stray = join(worktree, 'stray.html');
  copyFileSync(html, stray);
  const strayPdf = join(dataRoot, 'output', 'stray.pdf');
  const escape = runScript('generate-pdf.mjs', [stray, strayPdf, '--format=letter']);
  if (escape.status !== 0 && escape.output.includes('outside the tracker workspace') && !existsSync(strayPdf)) {
    pass('generate-pdf.mjs anchors its containment guard to the data root, not the script directory');
  } else {
    fail(`generate-pdf.mjs accepted an input inside the worktree (exit ${escape.status}):\n${escape.output.trim()}`);
  }

  // ── verify-cv-facts.mjs ────────────────────────────────────────────────
  const gate = runScript('verify-cv-facts.mjs', [html, '--json']);
  let verdict = null;
  try { verdict = JSON.parse(gate.stdout.trim().split('\n').pop()); } catch {}
  if (verdict && verdict.verdict !== 'block' && verdict.invented.length === 0 && verdict.unsupportedFacts.length === 0) {
    pass('verify-cv-facts.mjs reads cv.md from the data root when no --source is given');
  } else {
    fail(`verify-cv-facts.mjs failed a CV built from DATA_ROOT/cv.md (exit ${gate.status}):\n${gate.output.trim()}`);
  }

  // A number NOT in cv.md must still block, proving the pass above came from
  // reading the real source rather than from an empty one that checks nothing.
  const invented = join(dataRoot, 'output', 'cv-invented.html');
  writeFileSync(invented, '<html><body><p>Cut p95 latency 95% for 400 services.</p></body></html>', 'utf-8');
  const blocked = runScript('verify-cv-facts.mjs', [invented, '--json']);
  let blockedVerdict = null;
  try { blockedVerdict = JSON.parse(blocked.stdout.trim().split('\n').pop()); } catch {}
  if (blocked.status !== 0 && blockedVerdict?.verdict === 'block' && blockedVerdict.invented.includes('95%')) {
    pass('verify-cv-facts.mjs still blocks a number absent from the data-root cv.md');
  } else {
    fail(`verify-cv-facts.mjs did not block an invented number (exit ${blocked.status}):\n${blocked.output.trim()}`);
  }

  // ── In-process: the use-time root follows CAREER_OPS_ROOT too ──────────
  // refreshRootCache() used to key only on CAREER_OPS_TRACKER; a data-root
  // override set after import was invisible to the containment guard.
  const saved = Object.fromEntries(ENV_OVERRIDES.map((name) => [name, process.env[name]]));
  try {
    for (const name of ENV_OVERRIDES) delete process.env[name];
    const mod = await import('../generate-pdf.mjs');
    process.env.CAREER_OPS_ROOT = dataRoot;
    const overridden = mod.workspaceRelativeManifestPath(join(dataRoot, 'output', 'x.html'));
    delete process.env.CAREER_OPS_ROOT;
    const restored = mod.workspaceRelativeManifestPath(join(ROOT, 'output', 'y.html'));
    if (overridden === 'output/x.html' && restored === 'output/y.html') {
      pass('generate-pdf.mjs re-derives its workspace root when CAREER_OPS_ROOT changes after import');
    } else {
      fail(`workspace root did not follow CAREER_OPS_ROOT: overridden="${overridden}" restored="${restored}"`);
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
} finally {
  rmSync(worktree, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
}
