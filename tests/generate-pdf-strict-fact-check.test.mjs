/**
 * generate-pdf --strict-fact-check makes a `warn` verdict fatal (#6255 context).
 *
 * The fact gate has three verdicts — pass, warn, block — and until now only two
 * controls: run it, or --skip-fact-check it. A `warn` (claims the gate could not
 * read, a missing config/cv-facts.json) printed and the render continued, so a
 * caller that wants warnings to stop a CV had no flag for it — while the page
 * budget has had exactly that flag (--strict-pages) all along.
 *
 * Runs a copy of generate-pdf.mjs in a sandbox workspace with a stubbed
 * Chromium (same arrangement as generate-pdf-batch-fact-gate.test.mjs), so the
 * assertions observe exit status and whether a PDF landed, not the internals.
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, rmSync, linkRepoPackage, ROOT, NODE, SANDBOX_DATA_ROOT } from './helpers.mjs';

// Under the suite's own data root, not the checkout's output/: that directory
// is the developer's, and an interrupted run left a fixture in it once (#5113).
const outputRoot = join(SANDBOX_DATA_ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
// realpathSync for the reason generate-pdf-batch.test.mjs documents (#3165):
// the main-module guard compares realpaths.
const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'strict-fact-check-test-')));
const script = join(sandbox, 'generate-pdf.mjs');

for (const file of [
  'generate-pdf.mjs', 'verify-cv-facts.mjs', 'cv-voice.mjs', 'theme-style.mjs', 'cv-experience-order.mjs',
  'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
  'cv-sections-core.mjs', 'path-resolver.mjs',
]) copyFileSync(join(ROOT, file), join(sandbox, file));
mkdirSync(join(sandbox, 'lib'), { recursive: true });
for (const file of ['is-main-module.mjs', 'page-format.mjs', 'browser-launch.mjs', 'dir-lock.mjs', 'yaml-document.mjs', 'local-today.mjs', 'cv-markdown.mjs']) {
  copyFileSync(join(ROOT, 'lib', file), join(sandbox, 'lib', file));
}
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(join(sandbox, 'data', 'pdf-index.tsv'), '', 'utf-8');
linkRepoPackage(sandbox, 'js-yaml');

const playwrightStub = join(sandbox, 'node_modules', 'playwright');
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({ name: 'playwright', type: 'module', exports: './index.js' }), 'utf-8');
writeFileSync(join(playwrightStub, 'index.js'), `
const PDF = Buffer.from(\`%PDF-1.7
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

const cvDoc = (body) => `<!doctype html>\n<html>\n  <body>\n    <main><h1>Jordan Example</h1><p>${body}</p></main>\n  </body>\n</html>\n`;
writeFileSync(join(sandbox, 'cv.md'), '# Jordan Example\n\n- Led a team of 4 engineers and cut p95 latency by 30%.\n', 'utf-8');
writeFileSync(join(sandbox, 'honest.html'), cvDoc('Led a team of 4 engineers and cut p95 latency by 30%.'), 'utf-8');
// Inflated: a fabricated metric, a `block` verdict that already fails without
// any flag. Asserted as the control that --strict-fact-check did not loosen it.
writeFileSync(join(sandbox, 'inflated.html'), cvDoc('Led a team of 40 engineers and cut p95 latency by 30%.'), 'utf-8');
// Counts the extractor cannot read (its lexicon covers English, German and
// French): the verdict is `warn`, which is the verdict this flag targets.
writeFileSync(join(sandbox, 'unreadable-counts.html'), cvDoc('Dirigió 45 técnicos de mantenimiento en 3 obras.'), 'utf-8');

function run(args) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: sandbox,
    encoding: 'utf-8',
    timeout: 30_000,
    // Pin the workspace to the sandbox so a developer's own CAREER_OPS_ROOT
    // cannot hand the gate a different cv.md.
    env: { ...process.env, CAREER_OPS_ROOT: sandbox, CAREER_OPS_DATA_DIR: '' },
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

const rendered = (file) => existsSync(join(sandbox, file));

try {
  // Control: the fixture really is warn-only. Without this, a strict failure
  // below could just be a `block` the gate was already reporting.
  const control = run(['unreadable-counts.html', 'out/warn-default.pdf']);
  if (control.status === 0 && rendered('out/warn-default.pdf')
      && /CV fact check warning: unreadable-counts\.html/.test(control.output)
      && /not checked: 2 count-like claims/.test(control.output)) {
    pass('control: an unreadable-claims document warns and still renders without the flag');
  } else {
    fail(`warn control failed: status=${control.status} pdf=${rendered('out/warn-default.pdf')}\n${control.output.trim()}`);
  }

  const strictWarn = run(['unreadable-counts.html', 'out/warn-strict.pdf', '--strict-fact-check']);
  if (strictWarn.status === 1
      && !rendered('out/warn-strict.pdf')
      && /CV fact check warning: unreadable-counts\.html/.test(strictWarn.output)
      && /Fact check failed for unreadable-counts\.html/.test(strictWarn.output)
      && /--strict-fact-check: a warning is fatal/.test(strictWarn.output)) {
    pass('--strict-fact-check fails the render on a warn verdict and prints the warning first');
  } else {
    fail(`strict warn: status=${strictWarn.status} pdf=${rendered('out/warn-strict.pdf')}\n${strictWarn.output.trim()}`);
  }

  // The warning text itself is unchanged: the flag changes the exit, not the
  // report a caller reads.
  const warnedLines = (output) => output.split('\n').filter(line => /not checked: 2 count-like claims|45 técnicos/.test(line));
  if (warnedLines(control.output).length > 0
      && warnedLines(control.output).join('\n') === warnedLines(strictWarn.output).join('\n')) {
    pass('strict mode prints the same warning lines as the default mode');
  } else {
    fail(`warning lines differ between modes:\n${warnedLines(control.output).join('\n')}\n---\n${warnedLines(strictWarn.output).join('\n')}`);
  }

  const strictHonest = run(['honest.html', 'out/honest-strict.pdf', '--strict-fact-check']);
  if (strictHonest.status === 0 && rendered('out/honest-strict.pdf')
      && /Fact check passed: honest\.html/.test(strictHonest.output)) {
    pass('--strict-fact-check leaves a passing document alone');
  } else {
    fail(`strict honest: status=${strictHonest.status} pdf=${rendered('out/honest-strict.pdf')}\n${strictHonest.output.trim()}`);
  }

  const strictBlock = run(['inflated.html', 'out/inflated-strict.pdf', '--strict-fact-check']);
  if (strictBlock.status !== 0 && !rendered('out/inflated-strict.pdf')
      && /Fact check failed for inflated\.html/.test(strictBlock.output)) {
    pass('a block verdict is unchanged by the flag');
  } else {
    fail(`strict block: status=${strictBlock.status} pdf=${rendered('out/inflated-strict.pdf')}\n${strictBlock.output.trim()}`);
  }

  // Batch mode: the flag has to reach every entry, and a fatal warning must
  // fail that entry only, the way a block does.
  const manifest = join(sandbox, 'strict-manifest.json');
  writeFileSync(manifest, JSON.stringify([
    { input: 'honest.html', output: 'batch/honest.pdf' },
    { input: 'unreadable-counts.html', output: 'batch/warn.pdf' },
  ]), 'utf-8');
  const batch = run([`--batch=${manifest}`, '--strict-fact-check']);
  let results = null;
  try { results = JSON.parse(readFileSync(`${manifest}.results.json`, 'utf-8')); } catch { /* asserted below */ }
  const warnRow = Array.isArray(results) ? results.find(row => /warn\.pdf$/.test(row?.outputPath || '')) : null;
  if (batch.status === 1
      && rendered('batch/honest.pdf') && !rendered('batch/warn.pdf')
      && warnRow && warnRow.ok === false && /--strict-fact-check: a warning is fatal/.test(warnRow.error || '')) {
    pass('--batch --strict-fact-check fails the warning entry and still renders the rest');
  } else {
    fail(`batch strict: status=${batch.status} results=${JSON.stringify(results)}\n${batch.output.trim()}`);
  }

  // Contradictory flags are rejected before any render, rather than letting one
  // silently defeat the other in a shared invocation.
  const contradiction = run(['honest.html', 'out/contradiction.pdf', '--strict-fact-check', '--skip-fact-check']);
  if (contradiction.status === 1
      && !rendered('out/contradiction.pdf')
      && /--strict-fact-check cannot be combined with --skip-fact-check/.test(contradiction.output)) {
    pass('--strict-fact-check with --skip-fact-check is rejected by name');
  } else {
    fail(`contradictory flags: status=${contradiction.status} pdf=${rendered('out/contradiction.pdf')}\n${contradiction.output.trim()}`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}