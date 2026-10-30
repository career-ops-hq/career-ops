/**
 * generate-pdf checks a CV's facts against the cv.md of the workspace it
 * renders for, and says so when it cannot check at all.
 *
 * generate-pdf reads cv.md, for the section-order and locked-section guards
 * and to decide whether the fact gate runs, from its workspace root, which
 * follows CAREER_OPS_TRACKER outside the data root (#2471, #3169). The gate
 * itself, called with no sourcePaths, read verify-cv-facts' defaults: the DATA
 * root's cv.md. With the tracker in an external workspace, a CV claiming 40
 * engineers, against a workspace cv.md that says 4, passed the gate on the
 * data root's copy and rendered. A workspace with no cv.md skipped the gate
 * without a word, which reads exactly like a render that passed.
 *
 * Same sandbox arrangement as generate-pdf-batch-fact-gate.test.mjs: a copy
 * of generate-pdf.mjs and its imports with a stubbed Chromium.
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync as fsRmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, rmSync, linkRepoPackage, ROOT, NODE, SANDBOX_DATA_ROOT } from './helpers.mjs';

// Under the suite's own data root, not the checkout's output/ (#5113).
const outputRoot = join(SANDBOX_DATA_ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const base = realpathSync(mkdtempSync(join(outputRoot, 'fact-gate-workspace-test-')));
const code = join(base, 'code');       // the checkout, and the data root
const workspace = join(base, 'ext');   // where CAREER_OPS_TRACKER points
mkdirSync(code, { recursive: true });
const script = join(code, 'generate-pdf.mjs');
for (const file of [
  'generate-pdf.mjs', 'verify-cv-facts.mjs', 'theme-style.mjs', 'cv-experience-order.mjs',
  'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
  'cv-sections-core.mjs', 'path-resolver.mjs',
]) copyFileSync(join(ROOT, file), join(code, file));
mkdirSync(join(code, 'lib'), { recursive: true });
for (const file of ['is-main-module.mjs', 'page-format.mjs', 'dir-lock.mjs', 'yaml-document.mjs']) {
  copyFileSync(join(ROOT, 'lib', file), join(code, 'lib', file));
}
linkRepoPackage(code, 'js-yaml');
const playwrightStub = join(code, 'node_modules', 'playwright');
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({ name: 'playwright', type: 'module', exports: './index.js' }), 'utf-8');
writeFileSync(join(playwrightStub, 'index.js'), `
const PDF = Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n2 0 obj\\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\\nendobj\\n3 0 obj\\n<< /Type /Page /Parent 2 0 R >>\\nendobj\\n%%EOF', 'latin1');
const page = () => ({ async goto() {}, async evaluate() {}, async pdf() { return PDF; }, async close() {} });
export const chromium = {
  async launch() {
    return {
      async newContext() { return { async newPage() { return page(); }, async close() {} }; },
      async newPage() { return page(); },
      async close() {},
    };
  },
};
`, 'utf-8');

for (const dir of ['data', 'output']) mkdirSync(join(workspace, dir), { recursive: true });
mkdirSync(join(code, 'data'), { recursive: true });
writeFileSync(join(workspace, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n', 'utf-8');
writeFileSync(join(workspace, 'data', 'pdf-index.tsv'), '', 'utf-8');
writeFileSync(join(code, 'data', 'pdf-index.tsv'), '', 'utf-8');

const cvDoc = (bullet) => `<!doctype html>\n<html>\n  <body>\n    <main><h1>Jordan Example</h1><p>${bullet}</p></main>\n  </body>\n</html>\n`;
// The two cv.md files disagree on the one number the CV claims.
writeFileSync(join(code, 'cv.md'), '# Jordan Example\n\n- Led a team of 40 engineers.\n', 'utf-8');
const WORKSPACE_CV = '# Jordan Example\n\n- Led a team of 4 engineers.\n';
writeFileSync(join(workspace, 'inflated.html'), cvDoc('Led a team of 40 engineers.'), 'utf-8');
writeFileSync(join(workspace, 'honest.html'), cvDoc('Led a team of 4 engineers.'), 'utf-8');

function render(input) {
  const output = join(workspace, 'output', input.replace(/\.html$/, '.pdf'));
  fsRmSync(output, { force: true });
  const result = spawnSync(NODE, [script, join(workspace, input), output], {
    cwd: code,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: code, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: join(workspace, 'data', 'applications.md') },
  });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}`, rendered: existsSync(output) };
}

console.log('\ngenerate-pdf — the fact gate reads the workspace it renders for');

try {
  writeFileSync(join(workspace, 'cv.md'), WORKSPACE_CV, 'utf-8');

  // The other direction of the same split: checked against the data root's
  // cv.md ("40"), the honest "4" was blocked as an invented metric.
  const honest = render('honest.html');
  if (honest.status === 0 && honest.rendered && /Fact check passed: honest\.html/.test(honest.output)) {
    pass('a CV that matches the workspace cv.md passes, though the data root cv.md says otherwise');
  } else {
    fail(`honest CV against the workspace cv.md: status=${honest.status} rendered=${honest.rendered}\n${honest.output.trim()}`);
  }

  // THE BUG: the gate read the data root's cv.md ("40") and passed.
  const inflated = render('inflated.html');
  if (inflated.status !== 0 && !inflated.rendered && /Fact check failed for inflated\.html/.test(inflated.output)) {
    pass('a number absent from the workspace cv.md is blocked, though the data root cv.md has it');
  } else {
    fail(`inflated CV against the workspace cv.md: status=${inflated.status} rendered=${inflated.rendered}\n${inflated.output.trim()}`);
  }

  fsRmSync(join(workspace, 'cv.md'));
  const unchecked = render('honest.html');
  const notice = `Fact check did not run: no cv.md at ${join(workspace, 'cv.md')}`;
  if (unchecked.output.includes(notice) && !/Fact check passed/.test(unchecked.output)) {
    pass('with no workspace cv.md the render says the gate did not run');
  } else {
    fail(`no workspace cv.md: expected "${notice}"\n${unchecked.output.trim()}`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
