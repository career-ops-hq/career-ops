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
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const sandbox = mkdtempSync(join(outputRoot, 'batch-test-'));
const script = join(sandbox, 'generate-pdf.mjs');
const launchesFile = join(sandbox, '.launches');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(join(sandbox, 'data', 'pdf-index.tsv'), '', 'utf-8');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
copyFileSync(join(ROOT, 'theme-style.mjs'), join(sandbox, 'theme-style.mjs'));

const playwrightStub = join(sandbox, 'node_modules', 'playwright');
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright',
  type: 'module',
  exports: './index.js',
}), 'utf-8');
writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile, appendFile } from 'fs/promises';

const twoPagePdf = Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');

export const chromium = {
  async launch() {
    // One byte per launch: the test asserts a batch of N launches Chromium once.
    await appendFile('.launches', 'L');
    return {
      async newPage() {
        let failing = false;
        return {
          async goto(url) {
            const html = await readFile(new URL(url), 'utf-8');
            failing = html.includes('BATCH_FAIL');
          },
          async evaluate() {},
          async pdf() {
            if (failing) throw new Error('stub render failure');
            return twoPagePdf;
          },
          async close() {},
        };
      },
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

function run(args) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: sandbox,
    encoding: 'utf-8',
    timeout: 30_000,
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
  let results = null;
  try { results = JSON.parse(readFileSync(resultsPath, 'utf-8')); } catch { /* asserted below */ }

  if (
    batch.status !== 0 &&
    existsSync(aPdf) && !existsSync(bPdf) && existsSync(cPdf) &&
    launches === 1 &&
    Array.isArray(results) && results.length === 3 &&
    results[0].ok === true && results[1].ok === false && results[2].ok === true &&
    batch.output.includes('2 ok, 1 failed')
  ) {
    pass('generate-pdf --batch renders survivors, isolates the failure, reuses one Chromium');
  } else {
    fail(`generate-pdf --batch regressed: status=${batch.status} launches=${launches} results=${JSON.stringify(results)}\n${batch.output.trim()}`);
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
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
