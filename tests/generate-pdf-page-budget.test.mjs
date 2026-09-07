import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { isAbsolute, join, relative } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { pass, fail, linkRepoPackage, ROOT, NODE } from './helpers.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
// realpathSync, not the raw mkdtemp path: Node resolves both `import.meta.url`
// and a module's node_modules walk from a file's REALPATH, while
// `process.argv[1]` keeps whatever spelling the caller used. On a checkout with
// a symlinked output/ the two disagree, so generate-pdf.mjs's `isMain` guard is
// false and the spawned script exits 0 having done nothing at all -- assertions
// then fail against empty output rather than against behaviour (#3165).
const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'page-budget-test-')));
const externalOutput = realpathSync(mkdtempSync(join(outputRoot, 'page-budget-external-')));
const externalInputRoot = mkdtempSync(join(tmpdir(), 'career-ops-pdf-external-input-'));
const script = join(sandbox, 'generate-pdf.mjs');
const input = join(sandbox, 'two-pages.html');
const defaultOverflowInput = join(sandbox, 'three-pages.html');
const manifest = join(sandbox, 'data', 'pdf-index.tsv');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(manifest, '', 'utf-8');
const playwrightStub = join(sandbox, 'node_modules', 'playwright');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
// generate-pdf.mjs imports its local sibling ./theme-style.mjs (dynamic PDF
// theming, #1837); copy it into the sandbox too or the isolated script fails
// to load with ERR_MODULE_NOT_FOUND before it can parse any --max-pages arg.
copyFileSync(join(ROOT, 'theme-style.mjs'), join(sandbox, 'theme-style.mjs'));
// generate-pdf resolves output and manifest paths from the tracker-owned
// workspace. Copy the shared resolver and its local parser dependency so this
// remains a genuinely isolated CLI test.
copyFileSync(join(ROOT, 'tracker-utils.mjs'), join(sandbox, 'tracker-utils.mjs'));
copyFileSync(join(ROOT, 'tracker-parse.mjs'), join(sandbox, 'tracker-parse.mjs'));
copyFileSync(join(ROOT, 'tracker-aliases.json'), join(sandbox, 'tracker-aliases.json'));
copyFileSync(join(ROOT, 'pipeline-lock.mjs'), join(sandbox, 'pipeline-lock.mjs'));
// ...and it strips the optional sections that rendered as a bare header via
// ./cv-sections-core.mjs (#3986), another local sibling this sandbox needs.
copyFileSync(join(ROOT, 'cv-sections-core.mjs'), join(sandbox, 'cv-sections-core.mjs'));
// ...and generate-pdf resolves user-layer paths via path-resolver.mjs
// (CAREER_OPS_ROOT), so the fixture carries that too.
copyFileSync(join(ROOT, 'path-resolver.mjs'), join(sandbox, 'path-resolver.mjs'));
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
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright',
  type: 'module',
  exports: './index.js',
}), 'utf-8');
writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile, writeFile } from 'fs/promises';

const twoPagePdf = Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
5 0 obj
<< /Length 11 >>
stream
/Type /Page
endstream
endobj
%%EOF\`, 'latin1');

const threePagePdf = Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');

export const chromium = {
  async launch() {
    let renderedPdf = twoPagePdf;
    return {
      async newPage() {
        return {
          async goto(url) {
            const html = await readFile(new URL(url), 'utf-8');
            // Keep the document that actually reached the renderer, after every
            // transform generate-pdf.mjs applies to it. Written to the sandbox
            // (the spawned script's cwd) so a case can assert on it.
            await writeFile('.rendered.html', html, 'utf-8');
            renderedPdf = html.includes('THREE_PAGE_FIXTURE') ? threePagePdf : twoPagePdf;
          },
          async evaluate() {},
          async pdf() { return renderedPdf; },
        };
      },
      async close() {},
    };
  },
};
`, 'utf-8');
writeFileSync(input, `<!doctype html>
<html>
  <body>
    <main style="break-after: page">First page</main>
    <main>Second page</main>
  </body>
</html>
`, 'utf-8');
writeFileSync(defaultOverflowInput, `<!doctype html>
<html>
  <body>
    <main>First page</main>
    <main>Second page</main>
    <main>Third page — THREE_PAGE_FIXTURE</main>
  </body>
</html>
`, 'utf-8');
const externalInput = join(externalInputRoot, 'external-source.html');
copyFileSync(input, externalInput);

function runPdf(args, env = {}) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: sandbox,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return {
    ...result,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function countPages(path) {
  const pdf = readFileSync(path).toString('latin1');
  const declaredCounts = [...pdf.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,512}?\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]));
  return declaredCounts.length > 0 ? Math.max(...declaredCounts) : 0;
}

function stablePdf(path) {
  return readFileSync(path).toString('latin1')
    .replace(/\/(?:CreationDate|ModDate)\s*\([^)]*\)/g, '/Date()')
    .replace(/\/ID\s*\[\s*<[^>]+>\s*<[^>]+>\s*\]/g, '/ID[]');
}

function manifestHasPdf(path) {
  const expected = relative(sandbox, path).replaceAll('\\', '/');
  return readFileSync(manifest, 'utf-8')
    .split('\n')
    .some((line) => line.split('\t')[1] === expected);
}

try {
  for (const invalid of ['nope', '-1', '0', '1.5']) {
    const invalidOutput = join(sandbox, `invalid-${invalid.replace(/\W/g, '-')}.pdf`);
    const result = runPdf(['missing.html', invalidOutput, `--max-pages=${invalid}`]);
    if (
      result.status !== 0 &&
      result.output.includes(`Invalid --max-pages "${invalid}"`) &&
      !result.output.includes('ENOENT') &&
      !existsSync(invalidOutput)
    ) {
      pass(`generate-pdf rejects --max-pages=${invalid} before rendering`);
    } else {
      fail(`generate-pdf did not reject --max-pages=${invalid} before rendering: ${result.output.trim()}`);
    }
  }

  const withinBudgetPdf = join(sandbox, 'within-budget.pdf');
  // The common installation layout has the tracker workspace at the same
  // directory as the installed script. Keep that path explicitly covered so
  // workspace scoping remains a no-op for the default case.
  const defaultTracker = join(sandbox, 'applications.md');
  writeFileSync(defaultTracker, '# Applications\n', 'utf-8');
  const withinBudget = runPdf([input, withinBudgetPdf, '--max-pages=2'], {
    CAREER_OPS_TRACKER: defaultTracker,
  });
  if (
    withinBudget.status === 0 &&
    existsSync(withinBudgetPdf) &&
    countPages(withinBudgetPdf) === 2 &&
    manifestHasPdf(withinBudgetPdf)
  ) {
    pass('generate-pdf keeps default output working when tracker workspace equals install directory');
  } else {
    fail(`generate-pdf rejected a PDF inside its page budget: ${withinBudget.output.trim()}`);
  }

  const roomyBudgetPdf = join(sandbox, 'roomy-budget.pdf');
  const roomyBudget = runPdf([input, roomyBudgetPdf, '--max-pages=3']);
  if (
    roomyBudget.status === 0 &&
    existsSync(roomyBudgetPdf) &&
    stablePdf(roomyBudgetPdf) === stablePdf(withinBudgetPdf) &&
    manifestHasPdf(roomyBudgetPdf)
  ) {
    pass('changing an accepted page budget does not change deterministic PDF rendering');
  } else {
    fail('an accepted page budget changed the rendered PDF instead of acting only as a post-render decision');
  }

  const defaultOverflowPdf = join(sandbox, 'default-overflow.pdf');
  const defaultOverflow = runPdf([defaultOverflowInput, defaultOverflowPdf]);
  if (
    defaultOverflow.status === 0 &&
    existsSync(defaultOverflowPdf) &&
    countPages(defaultOverflowPdf) === 3 &&
    defaultOverflow.output.includes('📐 Page budget: 2 (warning only)') &&
    defaultOverflow.output.includes('⚠️') &&
    defaultOverflow.output.includes('CV is 3 pages') &&
    defaultOverflow.output.includes('allowed maximum is 2 pages') &&
    defaultOverflow.output.includes('--strict-pages') &&
    defaultOverflow.output.includes('✅ PDF generated') &&
    defaultOverflow.output.includes('Manifest:') &&
    manifestHasPdf(defaultOverflowPdf)
  ) {
    pass('generate-pdf warns loudly and publishes overflow by default');
  } else {
    fail(`generate-pdf default page budget regressed: ${defaultOverflow.output.trim()}`);
  }

  const strictOverflowPdf = join(sandbox, 'strict-overflow.pdf');
  const manifestBeforeStrictOverflow = readFileSync(manifest, 'utf-8');
  const strictOverflow = runPdf([input, strictOverflowPdf, '--max-pages=1', '--strict-pages']);
  if (
    strictOverflow.status !== 0 &&
    existsSync(strictOverflowPdf) &&
    countPages(strictOverflowPdf) === 2 &&
    strictOverflow.output.includes('📐 Page budget: 1 (strict)') &&
    strictOverflow.output.includes('CV is 2 pages') &&
    strictOverflow.output.includes('allowed maximum is 1 page') &&
    strictOverflow.output.includes('Trim') &&
    strictOverflow.output.includes('--strict-pages') &&
    !strictOverflow.output.includes('✅ PDF generated') &&
    !strictOverflow.output.includes('Manifest:') &&
    readFileSync(manifest, 'utf-8') === manifestBeforeStrictOverflow
  ) {
    pass('generate-pdf rejects overflow only with --strict-pages');
  } else {
    fail(`generate-pdf strict page budget regressed: ${strictOverflow.output.trim()}`);
  }

  // A redirected tracker defines a separate workspace. The renderer must allow
  // output there and honor an explicit manifest path instead of writing beside
  // the installed script.
  const redirectedRoot = join(sandbox, 'redirected-workspace');
  const redirectedInput = join(redirectedRoot, 'source.html');
  const redirectedPdf = join(redirectedRoot, 'output', 'redirected.pdf');
  const redirectedTracker = join(redirectedRoot, 'applications.md');
  const redirectedManifest = join(sandbox, 'custom-manifests', 'pdf-index.tsv');
  mkdirSync(join(redirectedRoot, 'output'), { recursive: true });
  writeFileSync(redirectedInput, readFileSync(input, 'utf8'), 'utf8');
  writeFileSync(redirectedTracker, '# Applications\n', 'utf8');

  const redirected = runPdf([redirectedInput, redirectedPdf, '--report=42'], {
    CAREER_OPS_TRACKER: redirectedTracker,
    CAREER_OPS_PDF_INDEX: redirectedManifest,
  });
  const redirectedManifestText = existsSync(redirectedManifest)
    ? readFileSync(redirectedManifest, 'utf8')
    : '';
  if (
    redirected.status === 0 &&
    existsSync(redirectedPdf) &&
    redirectedManifestText.split('\n').some((line) => {
      const fields = line.split('\t');
      return fields[0] === '42' && fields[1] === 'output/redirected.pdf' && fields[2] === 'source.html';
    })
  ) {
    pass('generate-pdf follows the tracker workspace and explicit manifest override');
  } else {
    fail(`generate-pdf ignored redirected workspace paths: ${redirected.output.trim()}`);
  }

  const linkedOutput = join(sandbox, 'linked-output');
  const escapedPdf = join(externalOutput, 'escaped.pdf');
  symlinkSync(externalOutput, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
  const symlinkEscape = runPdf([input, join(linkedOutput, 'escaped.pdf')]);
  if (
    symlinkEscape.status !== 0 &&
    symlinkEscape.output.includes('Refusing to write the PDF outside the tracker workspace') &&
    !existsSync(escapedPdf)
  ) {
    pass('generate-pdf rejects output directories symlinked outside the tracker workspace');
  } else {
    fail(`generate-pdf followed an output symlink outside its workspace: ${symlinkEscape.output.trim()}`);
  }
  // An external input path must not move the renderer's temporary HTML out of
  // the tracker workspace via the CLI's baseDir derivation.
  const externalInputPdf = join(sandbox, 'external-input.pdf');
  const externalInputRun = runPdf([externalInput, externalInputPdf]);
  const externalTempFiles = readdirSync(externalInputRoot)
    .filter((name) => name.startsWith('.career-ops-render-'));
  if (
    externalInputRun.status !== 0 &&
    externalInputRun.output.includes('Refusing to write the PDF outside the tracker workspace') &&
    !existsSync(externalInputPdf) &&
    externalTempFiles.length === 0
  ) {
    pass('generate-pdf rejects external input paths before creating temporary files');
  } else {
    fail(`generate-pdf mishandled an external input path: ${externalInputRun.output.trim()}`);
  }

  // Observe the temporary path before renderer cleanup. The CLI rejects an
  // external input path, so call the renderer directly to cover its public
  // baseDir option as well.
  const { renderHtmlToPdf } = await import(pathToFileURL(script).href);
  const directPdf = join(sandbox, 'direct-external-base-dir.pdf');
  let observedTempPath = '';
  const directResult = await renderHtmlToPdf('<!doctype html><html><body>direct</body></html>', directPdf, {
    baseDir: externalInputRoot,
    workspaceRoot: sandbox,
    inputPath: input,
    launchBrowser: async () => ({
      async newPage() {
        return {
          async goto(url) { observedTempPath = fileURLToPath(url); },
          async evaluate() {},
          async pdf() {
            return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n%%EOF');
          },
        };
      },
      async close() {},
    }),
  });
  const tempRelativeToWorkspace = relative(sandbox, observedTempPath);
  const tempRelativeToExternal = relative(externalInputRoot, observedTempPath);
  const tempInsideWorkspace = tempRelativeToWorkspace !== ''
    && !tempRelativeToWorkspace.startsWith('..')
    && !isAbsolute(tempRelativeToWorkspace);
  const tempInsideExternal = tempRelativeToExternal === ''
    || (!tempRelativeToExternal.startsWith('..') && !isAbsolute(tempRelativeToExternal));
  if (
    directResult?.outputPath === directPdf &&
    tempInsideWorkspace &&
    !tempInsideExternal
  ) {
    pass('renderHtmlToPdf keeps an external baseDir temporary file inside the workspace');
  } else {
    fail(`renderHtmlToPdf placed its temporary file outside the workspace: ${observedTempPath}`);
  }
  // --- Optional sections that arrived as a bare header (#3986) -------------
  // The builders strip these from the payload before filling a template, but
  // neither builder runs on the web pdf path: the agent emits finished HTML,
  // which reaches this script with the empty wrappers intact. Assert on the
  // document the renderer actually received, so removing the call in
  // generate-pdf.mjs fails here and not only in the unit suite for the module.
  const bareHeaderInput = join(sandbox, 'bare-header-sections.html');
  writeFileSync(bareHeaderInput, `<!doctype html>
<html>
  <body>
    <!-- WORK EXPERIENCE -->
    <div class="section">
      <div class="section-title">Work Experience</div>
      <div class="job">Staff Engineer, Acme</div>
    </div>

    <!-- PROJECTS -->
    <div class="section">
      <div class="section-title">Projects</div>
    </div>

    <!-- EDUCATION -->
    <div class="section">
      <div class="section-title">Education</div>
      <div class="edu">BSc, 2015</div>
    </div>

    <!-- END -->
  </body>
</html>
`, 'utf-8');
  const bareHeaderPdf = join(sandbox, 'bare-header-sections.pdf');
  const bareHeaderRun = runPdf([bareHeaderInput, bareHeaderPdf]);
  const renderedHtml = existsSync(join(sandbox, '.rendered.html'))
    ? readFileSync(join(sandbox, '.rendered.html'), 'utf-8')
    : '';
  if (
    bareHeaderRun.status === 0 &&
    renderedHtml !== '' &&
    !renderedHtml.includes('<!-- PROJECTS -->') &&
    renderedHtml.includes('<!-- WORK EXPERIENCE -->') &&
    renderedHtml.includes('Staff Engineer, Acme') &&
    renderedHtml.includes('<!-- EDUCATION -->') &&
    renderedHtml.includes('BSc, 2015')
  ) {
    pass('generate-pdf drops a section that arrived as a bare header and keeps the populated ones');
  } else {
    fail(`generate-pdf did not strip the empty Projects section from the rendered document: ${bareHeaderRun.output.trim()}`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(externalOutput, { recursive: true, force: true });
  rmSync(externalInputRoot, { recursive: true, force: true });
}
