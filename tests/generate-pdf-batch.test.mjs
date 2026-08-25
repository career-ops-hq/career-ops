/**
 * generate-pdf batch mode (#2384).
 *
 * Verifies the --batch path renders N documents through ONE shared Chromium,
 * that one failing document does not poison the rest (maintainer condition 2),
 * that the shared browser is launched exactly once and closed at the batch
 * boundary (condition 1), and that a single-CV render stays byte-identical to
 * the same document rendered inside a batch (condition 3, normalized for the
 * non-deterministic /CreationDate /ModDate /ID fields Chromium always embeds).
 *
 * The stubbed Chromium counts launches and throws inside page.pdf() for any
 * document whose HTML carries the BATCH_FAIL marker, so "middle entry throws"
 * is a real render failure, not a prep/validation error.
 */
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, linkRepoPackage, ROOT, NODE } from './helpers.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
// realpathSync, not the raw mkdtemp path: Node resolves both `import.meta.url`
// and a module's node_modules walk from a file's REALPATH, while
// `process.argv[1]` keeps whatever spelling the caller used. On a checkout with
// a symlinked output/ the two disagree, so generate-pdf.mjs's `isMain` guard is
// false and the spawned script exits 0 having done nothing at all -- assertions
// then fail against empty output rather than against behaviour (#3165).
const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'batch-test-')));
const script = join(sandbox, 'generate-pdf.mjs');
const launchesFile = join(sandbox, '.launches');
const pageClosesFile = join(sandbox, '.pagecloses');
const contextClosesFile = join(sandbox, '.contextcloses');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(join(sandbox, 'data', 'pdf-index.tsv'), '', 'utf-8');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
copyFileSync(join(ROOT, 'theme-style.mjs'), join(sandbox, 'theme-style.mjs'));
copyFileSync(join(ROOT, 'tracker-utils.mjs'), join(sandbox, 'tracker-utils.mjs'));
copyFileSync(join(ROOT, 'tracker-parse.mjs'), join(sandbox, 'tracker-parse.mjs'));
copyFileSync(join(ROOT, 'tracker-aliases.json'), join(sandbox, 'tracker-aliases.json'));
copyFileSync(join(ROOT, 'pipeline-lock.mjs'), join(sandbox, 'pipeline-lock.mjs'));
// generate-pdf.mjs's main-guard lives in lib/is-main-module.mjs (#3170). Without
// it the copy dies with ERR_MODULE_NOT_FOUND before parsing an argument.
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'lib', 'is-main-module.mjs'), join(sandbox, 'lib', 'is-main-module.mjs'));

// theme-style.mjs and tracker-utils.mjs both `import * as yaml from 'js-yaml'`,
// which resolves by walking up into the repo's node_modules -- from the
// sandbox's REALPATH, so a checkout with a symlinked output/ never reaches it
// and every spawned generate-pdf dies before parsing argv (#3165). Link the
// package in beside the playwright stub so the sandbox stands on its own.
linkRepoPackage(sandbox, 'js-yaml');

const playwrightStub = join(sandbox, 'node_modules', 'playwright');
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright',
  type: 'module',
  exports: './index.js',
}), 'utf-8');
writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile, appendFile } from 'fs/promises';

// A valid two-page PDF whose body embeds the rendered HTML, so per-document
// output reflects per-document input instead of being a constant blob. Chromium
// really does vary the PDF bytes by page content; a constant stub would let a
// single-vs-batch comparison pass even if the two paths rendered different HTML.
function twoPagePdf(markerText) {
  const marker = Buffer.from(markerText, 'utf-8').toString('base64');
  return Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Marker (\${marker}) >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');
}

function makePage() {
  let failing = false;
  let renderedHtml = '';
  return {
    async goto(url) {
      const html = await readFile(new URL(url), 'utf-8');
      renderedHtml = html;
      failing = html.includes('BATCH_FAIL');
    },
    async evaluate() {},
    async pdf() {
      if (failing) throw new Error('stub render failure');
      // Reflect the captured HTML in the returned bytes so different documents
      // produce different PDFs (and identical HTML stays byte-identical).
      return twoPagePdf(renderedHtml);
    },
    // Record every page close so the test can assert renderInPage tears down
    // exactly one page per document (no leak into the shared browser).
    async close() { await appendFile('.pagecloses', 'P'); },
  };
}

export const chromium = {
  async launch() {
    // Simulate an unrecoverable shared-browser launch failure on demand so the
    // batch path's launch-failure handling (complete failed manifest + exit 1)
    // can be exercised without a constant blob masking it.
    if (process.env.BATCH_LAUNCH_FAIL) throw new Error('stub launch failure');
    // One byte per launch: the test asserts a batch of N launches Chromium once.
    await appendFile('.launches', 'L');
    return {
      // renderInPage prefers newContext({javaScriptEnabled:false}); support it so
      // the test exercises the real context path, with newPage() as the fallback.
      async newContext() {
        return {
          async newPage() { return makePage(); },
          // Record every context close so the test can assert renderInPage tears
          // down exactly one JS-disabled context per document.
          async close() { await appendFile('.contextcloses', 'C'); },
        };
      },
      async newPage() { return makePage(); },
      async close() {},
    };
  },
};
`, 'utf-8');

function htmlDoc(body) {
  return `<!doctype html>\n<html>\n  <body>\n    <main>${body}</main>\n  </body>\n</html>\n`;
}

writeFileSync(join(sandbox, 'a.html'), htmlDoc('Alpha CV'), 'utf-8');
writeFileSync(join(sandbox, 'b.html'), htmlDoc('Bravo CV BATCH_FAIL'), 'utf-8');
writeFileSync(join(sandbox, 'c.html'), htmlDoc('Charlie CV'), 'utf-8');
writeFileSync(join(sandbox, 'single.html'), htmlDoc('Solo CV'), 'utf-8');

function run(args, { env, cwd } = {}) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: cwd || sandbox,
    encoding: 'utf-8',
    timeout: 30_000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function stablePdf(path) {
  return readFileSync(path).toString('latin1')
    .replace(/\/(?:CreationDate|ModDate)\s*\([^)]*\)/g, '/Date()')
    .replace(/\/ID\s*\[\s*<[^>]+>\s*<[^>]+>\s*\]/g, '/ID[]');
}

try {
  // --- Test 1: middle entry throws; 1 + 3 still land, browser reused once ---
  const manifest = join(sandbox, 'batch.json');
  writeFileSync(manifest, JSON.stringify([
    { input: 'a.html', output: 'out/a.pdf' },
    { input: 'b.html', output: 'out/b.pdf' },
    { input: 'c.html', output: 'out/c.pdf' },
  ]), 'utf-8');

  const batch = run([`--batch=${manifest}`]);
  const aPdf = join(sandbox, 'out', 'a.pdf');
  const bPdf = join(sandbox, 'out', 'b.pdf');
  const cPdf = join(sandbox, 'out', 'c.pdf');
  const resultsPath = `${manifest}.results.json`;
  const launches = existsSync(launchesFile) ? readFileSync(launchesFile, 'utf-8').length : 0;
  // Per-document cleanup: renderInPage opens one JS-disabled context + one page
  // per entry and closes both in a finally, even for the entry that throws in
  // pdf(). A 3-entry batch must therefore close exactly 3 pages and 3 contexts.
  const pageCloses = existsSync(pageClosesFile) ? readFileSync(pageClosesFile, 'utf-8').length : 0;
  const contextCloses = existsSync(contextClosesFile) ? readFileSync(contextClosesFile, 'utf-8').length : 0;
  let results = null;
  try { results = JSON.parse(readFileSync(resultsPath, 'utf-8')); } catch { /* asserted below */ }

  if (
    batch.status === 1 &&
    existsSync(aPdf) && !existsSync(bPdf) && existsSync(cPdf) &&
    launches === 1 &&
    pageCloses === 3 && contextCloses === 3 &&
    Array.isArray(results) && results.length === 3 &&
    results[0].ok === true && results[1].ok === false && results[2].ok === true &&
    batch.output.includes('2 ok, 1 failed')
  ) {
    pass('generate-pdf --batch renders survivors, isolates the failure, reuses one Chromium, closes every page + context');
  } else {
    fail(`generate-pdf --batch regressed: status=${batch.status} launches=${launches} pageCloses=${pageCloses} contextCloses=${contextCloses} results=${JSON.stringify(results)}\n${batch.output.trim()}`);
  }

  // --- Test 2: single-CV render is byte-identical to the batch render ---
  const singlePdf = join(sandbox, 'out', 'single-direct.pdf');
  const single = run(['single.html', 'out/single-direct.pdf']);

  const singleManifest = join(sandbox, 'single-batch.json');
  writeFileSync(singleManifest, JSON.stringify([
    { input: 'single.html', output: 'out/single-batch.pdf' },
  ]), 'utf-8');
  const singleBatch = run([`--batch=${singleManifest}`]);
  const singleBatchPdf = join(sandbox, 'out', 'single-batch.pdf');

  if (
    single.status === 0 && singleBatch.status === 0 &&
    existsSync(singlePdf) && existsSync(singleBatchPdf) &&
    stablePdf(singlePdf) === stablePdf(singleBatchPdf)
  ) {
    pass('single-CV render stays byte-identical (normalized) to the same document in a batch');
  } else {
    fail(`single vs batch render diverged: single=${single.status} batch=${singleBatch.status}\n${single.output.trim()}\n${singleBatch.output.trim()}`);
  }

  // --- Test 3: an all-success batch exits 0 ---
  const okManifest = join(sandbox, 'ok-batch.json');
  writeFileSync(okManifest, JSON.stringify([
    { input: 'a.html', output: 'out/ok-a.pdf' },
    { input: 'c.html', output: 'out/ok-c.pdf' },
  ]), 'utf-8');
  const okBatch = run([`--batch=${okManifest}`]);
  if (
    okBatch.status === 0 &&
    existsSync(join(sandbox, 'out', 'ok-a.pdf')) &&
    existsSync(join(sandbox, 'out', 'ok-c.pdf')) &&
    okBatch.output.includes('2 ok, 0 failed')
  ) {
    pass('generate-pdf --batch exits 0 when every document renders');
  } else {
    fail(`all-success batch did not exit clean: status=${okBatch.status}\n${okBatch.output.trim()}`);
  }

  // --- Test 4: a shared-browser launch failure yields a complete failed
  // manifest and exit 1, never an uncaught throw that skips the manifest ---
  const failManifest = join(sandbox, 'launchfail.json');
  writeFileSync(failManifest, JSON.stringify([
    { input: 'a.html', output: 'out/lf-a.pdf' },
    { input: 'c.html', output: 'out/lf-c.pdf' },
  ]), 'utf-8');
  const launchFail = run([`--batch=${failManifest}`], { env: { BATCH_LAUNCH_FAIL: '1' } });
  let lfResults = null;
  try { lfResults = JSON.parse(readFileSync(`${failManifest}.results.json`, 'utf-8')); } catch { /* asserted below */ }
  if (
    launchFail.status === 1 &&
    Array.isArray(lfResults) && lfResults.length === 2 &&
    lfResults.every((r) => r && r.ok === false && /launch failed/i.test(r.error || '')) &&
    !existsSync(join(sandbox, 'out', 'lf-a.pdf')) &&
    !existsSync(join(sandbox, 'out', 'lf-c.pdf')) &&
    launchFail.output.includes('0 ok, 2 failed')
  ) {
    pass('generate-pdf --batch records every entry failed on browser launch failure (exit 1)');
  } else {
    fail(`launch-failure batch mishandled: status=${launchFail.status} results=${JSON.stringify(lfResults)}\n${launchFail.output.trim()}`);
  }

  // --- Test 5: input/output paths escaping the project are rejected per-entry,
  // while a valid sibling entry still renders ---
  const escapeManifest = join(sandbox, 'escape.json');
  writeFileSync(escapeManifest, JSON.stringify([
    { input: 'a.html', output: 'out/esc-ok.pdf' },
    { input: '../a.html', output: 'out/esc-badin.pdf' },
    { input: 'a.html', output: '../esc-badout.pdf' },
  ]), 'utf-8');
  const escape = run([`--batch=${escapeManifest}`]);
  let escResults = null;
  try { escResults = JSON.parse(readFileSync(`${escapeManifest}.results.json`, 'utf-8')); } catch { /* asserted below */ }
  if (
    escape.status === 1 &&
    Array.isArray(escResults) && escResults.length === 3 &&
    escResults[0].ok === true &&
    escResults[1].ok === false && /input escapes/i.test(escResults[1].error || '') &&
    escResults[2].ok === false && /output escapes/i.test(escResults[2].error || '') &&
    existsSync(join(sandbox, 'out', 'esc-ok.pdf'))
  ) {
    pass('generate-pdf --batch rejects input/output paths that escape the tracker workspace');
  } else {
    fail(`containment guard regressed: status=${escape.status} results=${JSON.stringify(escResults)}\n${escape.output.trim()}`);
  }

  // --- Test 6: manifest-supplied paths resolve relative to the manifest's own
  // directory, not process.cwd() ---
  const subDir = join(sandbox, 'sub');
  mkdirSync(subDir, { recursive: true });
  const relManifest = join(subDir, 'rel.json');
  writeFileSync(relManifest, JSON.stringify([
    { input: '../a.html', output: '../out/rel.pdf' },
  ]), 'utf-8');
  // cwd (sandbox) differs from the manifest dir (sandbox/sub): if paths resolved
  // against cwd, ../a.html would escape and fail; resolved against the manifest
  // dir it lands on sandbox/a.html and renders cleanly.
  const relRun = run([`--batch=${relManifest}`]);
  if (
    relRun.status === 0 &&
    existsSync(join(sandbox, 'out', 'rel.pdf')) &&
    relRun.output.includes('1 ok, 0 failed')
  ) {
    pass('generate-pdf --batch resolves manifest paths relative to the manifest directory');
  } else {
    fail(`manifest-relative path resolution regressed: status=${relRun.status}\n${relRun.output.trim()}`);
  }

  // --- Test 7: a --batch manifest that lives OUTSIDE the workspace is rejected
  // before any filesystem access — the manifest is never read (error is the
  // containment error, not a parse/read error) and no .results.json is written
  // next to it (the write is gated too) ---
  const externalDir = mkdtempSync(join(tmpdir(), 'batch-ext-'));
  try {
    const externalManifest = join(externalDir, 'external.json');
    // Valid JSON pointing at a valid entry: if containment did NOT gate first,
    // the code would read this and proceed, producing a results file. It must not.
    writeFileSync(externalManifest, JSON.stringify([
      { input: 'a.html', output: 'out/ext.pdf' },
    ]), 'utf-8');
    const ext = run([`--batch=${externalManifest}`]);
    const extResults = `${externalManifest}.results.json`;
    if (
      ext.status === 1 &&
      /batch manifest escapes the tracker workspace/i.test(ext.output) &&
      !existsSync(extResults)
    ) {
      pass('generate-pdf --batch rejects an external manifest path before any filesystem access');
    } else {
      fail(`external manifest containment regressed: status=${ext.status} resultsExist=${existsSync(`${externalManifest}.results.json`)}\n${ext.output.trim()}`);
    }
  } finally {
    rmSync(externalDir, { recursive: true, force: true });
  }

  // --- Test 8: every entry renders, but writing the .results.json manifest
  // fails — the batch must still exit 1, never mask a manifest write failure
  // behind a clean exit. A directory pre-created at the results path forces
  // writeFileSync to throw (EISDIR/EPERM) while the workspace guard passes. ---
  const wfManifest = join(sandbox, 'writefail.json');
  writeFileSync(wfManifest, JSON.stringify([
    { input: 'a.html', output: 'out/wf-a.pdf' },
    { input: 'c.html', output: 'out/wf-c.pdf' },
  ]), 'utf-8');
  // Occupy the results path with a directory so the file write cannot succeed.
  mkdirSync(`${wfManifest}.results.json`, { recursive: true });
  const writeFail = run([`--batch=${wfManifest}`]);
  if (
    writeFail.status === 1 &&
    writeFail.output.includes('2 ok, 0 failed') &&
    /Could not write batch results manifest/i.test(writeFail.output) &&
    existsSync(join(sandbox, 'out', 'wf-a.pdf')) &&
    existsSync(join(sandbox, 'out', 'wf-c.pdf'))
  ) {
    pass('generate-pdf --batch exits 1 when the results manifest write fails despite all renders succeeding');
  } else {
    fail(`results-write failure did not fail the batch: status=${writeFail.status}\n${writeFail.output.trim()}`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
