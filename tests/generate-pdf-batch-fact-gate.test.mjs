/**
 * generate-pdf --batch runs the fact gate on every manifest entry.
 *
 * The single-file path blocks a CV whose metrics or facts are absent from
 * cv.md, because a programmatic caller "rendered inflated metrics in silence"
 * when the gate was only an instructed step. The --batch path is that caller,
 * and it read cv.md for the section-order guard and nothing else: a manifest
 * whose CV said "40 engineers" against a cv.md that says 4 rendered and exited 0.
 *
 * Runs a copy of generate-pdf.mjs in a sandbox workspace with a stubbed
 * Chromium (same arrangement as generate-pdf-batch.test.mjs), so a blocked
 * entry is observed the way a caller sees it: no PDF, a failed row in
 * <manifest>.results.json and a non-zero exit, with the other entries rendered.
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, rmSync, linkRepoPackage, ROOT, NODE, SANDBOX_DATA_ROOT } from './helpers.mjs';

// Under the suite's own data root, not the checkout's output/: that directory
// is the developer's, and an interrupted run left this fixture in it (#5113).
const outputRoot = join(SANDBOX_DATA_ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
// realpathSync for the reason generate-pdf-batch.test.mjs documents (#3165):
// the main-module guard compares realpaths.
const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'batch-fact-gate-test-')));
const script = join(sandbox, 'generate-pdf.mjs');

// generate-pdf.mjs, its static imports, and verify-cv-facts.mjs — the gate is
// imported lazily, so a sandbox without it would pass every entry unchecked
// only if the gate were never reached. Here it must be reached.
for (const file of [
  'generate-pdf.mjs', 'verify-cv-facts.mjs', 'theme-style.mjs', 'cv-experience-order.mjs',
  'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
  'cv-sections-core.mjs', 'path-resolver.mjs',
]) copyFileSync(join(ROOT, file), join(sandbox, file));
mkdirSync(join(sandbox, 'lib'), { recursive: true });
for (const file of ['is-main-module.mjs', 'page-format.mjs', 'dir-lock.mjs', 'yaml-document.mjs']) {
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

const cvDoc = (bullet) => `<!doctype html>\n<html>\n  <body>\n    <main><h1>Jordan Example</h1><p>${bullet}</p></main>\n  </body>\n</html>\n`;
writeFileSync(join(sandbox, 'cv.md'), '# Jordan Example\n\n- Led a team of 4 engineers and cut p95 latency by 30%.\n', 'utf-8');
writeFileSync(join(sandbox, 'honest.html'), cvDoc('Led a team of 4 engineers and cut p95 latency by 30%.'), 'utf-8');
writeFileSync(join(sandbox, 'inflated.html'), cvDoc('Led a team of 40 engineers and cut p95 latency by 30%.'), 'utf-8');
writeFileSync(join(sandbox, 'honest-too.html'), cvDoc('Cut p95 latency by 30%.'), 'utf-8');
// Counts the English-only extractor cannot read: the gate warns, and says why.
writeFileSync(join(sandbox, 'french.html'), cvDoc('Dirigé 45 techniciens de maintenance sur 3 chantiers.'), 'utf-8');

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

function runBatch(name, flags = []) {
  const manifest = join(sandbox, `${name}.json`);
  writeFileSync(manifest, JSON.stringify([
    { input: 'honest.html', output: `${name}/honest.pdf` },
    { input: 'inflated.html', output: `${name}/inflated.pdf` },
    { input: 'honest-too.html', output: `${name}/honest-too.pdf` },
  ]), 'utf-8');
  const result = run([`--batch=${manifest}`, ...flags]);
  let results = null;
  try { results = JSON.parse(readFileSync(`${manifest}.results.json`, 'utf-8')); } catch { /* asserted by the caller */ }
  const rendered = (file) => existsSync(join(sandbox, name, file));
  return { ...result, results, rendered };
}

try {
  // Control first: the fixtures must behave on the single-file path the way the
  // batch assertions assume, or a batch failure below would prove nothing.
  const singleHonest = run(['honest.html', 'single/honest.pdf']);
  const singleInflated = run(['inflated.html', 'single/inflated.pdf']);
  if (singleHonest.status === 0 && singleInflated.status !== 0
      && /Fact check failed for inflated\.html/.test(singleInflated.output)
      && !existsSync(join(sandbox, 'single', 'inflated.pdf'))) {
    pass('control: the single-file path renders the honest CV and blocks the inflated one');
  } else {
    fail(`single-file fact gate control failed: honest=${singleHonest.status} inflated=${singleInflated.status}\n${singleHonest.output.trim()}\n${singleInflated.output.trim()}`);
  }

  const gated = runBatch('gated');
  if (gated.status === 1
      && gated.rendered('honest.pdf') && !gated.rendered('inflated.pdf') && gated.rendered('honest-too.pdf')
      && Array.isArray(gated.results) && gated.results.length === 3
      && gated.results[0].ok === true && gated.results[2].ok === true
      && gated.results[1].ok === false
      && /Fact check failed for inflated\.html/.test(gated.results[1].error || '')
      && /\b40\b/.test(gated.results[1].error || '')
      && gated.output.includes('2 ok, 1 failed')) {
    pass('--batch blocks the entry with an unsupported metric, records why, and still renders the rest');
  } else {
    fail(`--batch fact gate: status=${gated.status} results=${JSON.stringify(gated.results)}\n${gated.output.trim()}`);
  }

  // Every entry goes through the gate, not only the one that fails.
  const passes = (gated.output.match(/Fact check passed/g) || []).length;
  if (passes === 2) pass('--batch gates every entry (both honest CVs report a passed check)');
  else fail(`--batch: expected 2 passed fact checks, saw ${passes}\n${gated.output.trim()}`);

  const skipped = runBatch('skipped', ['--skip-fact-check']);
  if (skipped.status === 0
      && skipped.rendered('honest.pdf') && skipped.rendered('inflated.pdf') && skipped.rendered('honest-too.pdf')
      && Array.isArray(skipped.results) && skipped.results.every(r => r && r.ok === true)
      && !/Fact check/.test(skipped.output)) {
    pass('--batch --skip-fact-check renders every entry without running the gate');
  } else {
    fail(`--batch --skip-fact-check: status=${skipped.status} results=${JSON.stringify(skipped.results)}\n${skipped.output.trim()}`);
  }

  // The warning carries its reason (#5348). runFactGate printed the header and
  // the advisory phrases but never the coverage note, so a document the gate
  // could not read showed "CV fact check warning" with nothing under it.
  const french = run(['french.html', 'single/french.pdf']);
  if (french.status === 0
      && /CV fact check warning: french\.html/.test(french.output)
      && /not checked: 2 count-like claims/.test(french.output)
      && /45 techniciens/.test(french.output)) {
    pass('a warning prints what the gate could not check, not just the header');
  } else {
    fail(`single-file coverage warning: status=${french.status}\n${french.output.trim()}`);
  }

  const singleSkipped = run(['inflated.html', 'single/inflated-skipped.pdf', '--skip-fact-check']);
  if (singleSkipped.status === 0 && existsSync(join(sandbox, 'single', 'inflated-skipped.pdf'))) {
    pass('--skip-fact-check is unchanged on the single-file path');
  } else {
    fail(`single-file --skip-fact-check: status=${singleSkipped.status}\n${singleSkipped.output.trim()}`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
