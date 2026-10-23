/** Moving protected render scratch files must preserve local resource URLs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { SANDBOX_DATA_ROOT } from './helpers.mjs';
import { renderHtmlToPdf } from '../generate-pdf.mjs';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
  + '2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n%%EOF');

test('protected rendering writes the browser-normalized HTML only to private scratch', {
  skip: process.platform === 'win32' && 'Protected writes require POSIX',
}, async () => {
  const root = mkdtempSync(join(SANDBOX_DATA_ROOT, 'protected-resource-stub-'));
  let scratch;
  let transformed = false;
  const normalized = '<!doctype html><html><head><base href="file:///normalized/"></head><body>CV</body></html>';
  try {
    await renderHtmlToPdf('<p>CV</p>', join(root, 'cv.pdf'), {
      workspaceRoot: root, noClobber: true, format: 'a4',
      launchBrowser: async () => ({
        async newContext(options) {
          assert.equal(options.javaScriptEnabled, false);
          return {
            async newPage() { return {
              async route() {},
              async evaluate(_callback, value) {
                if (!value) return;
                assert.equal(value.baseHref, pathToFileURL(root + '/').href);
                assert.ok(value.html.includes('<p>CV</p>'));
                transformed = true;
                return normalized;
              },
              async goto(url) {
                scratch = fileURLToPath(url);
                assert.equal(transformed, true);
                assert.notEqual(dirname(scratch), root);
                assert.equal(readFileSync(scratch, 'utf8'), normalized);
              },
              async pdf() { return PDF; },
              async close() {},
            }; },
            async close() {},
          };
        },
        async close() {},
      }),
    });
    assert.deepEqual(readFileSync(join(root, 'cv.pdf')), PDF);
    assert.equal(existsSync(scratch), false);
    assert.equal(existsSync(dirname(scratch)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('protected local images and styles retain browser base-URL semantics', {
  skip: process.platform === 'win32' && 'Protected writes require POSIX',
}, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message.split('\n')[0]}`); return; }
  const root = mkdtempSync(join(SANDBOX_DATA_ROOT, 'protected-resources-'));
  const inputDir = join(root, 'input');
  const assets = join(root, 'assets');
  const encodedAssets = join(root, 'a&b');
  const resources = '<link rel="stylesheet" href="theme.css"><img id="photo" src="photo.svg"><p id="probe">CV</p>';
  const document = head => `<!doctype html><html><head>${head}</head><body>${resources}<script>window.ran = true</script></body></html>`;
  const cases = [
    ['default head', document(''), inputDir, 'CSS1Compat'],
    ['relative base', document('<base href="../assets/">'), assets, 'CSS1Compat'],
    ['unquoted relative base', document('<base href=../assets/>'), assets, 'CSS1Compat'],
    ['commented base', document('<!-- <base href="file:///missing/"> -->'), inputDir, 'CSS1Compat'],
    ['base-like raw text', document('<style>/* <base href="file:///missing/"> */</style>'), inputDir, 'CSS1Compat'],
    ['missing head and doctype', resources, inputDir, 'BackCompat'],
    ['encoded base attribute', document('<base href="../a&amp;b/">'), encodedAssets, 'CSS1Compat'],
    ['first base wins', document('<base href="../assets/"><base href="file:///missing/">'), assets, 'CSS1Compat'],
    ['absolute base', document(`<base href="${pathToFileURL(assets + '/').href}">`), assets, 'CSS1Compat'],
  ];
  try {
    for (const dir of [inputDir, assets, encodedAssets]) {
      mkdirSync(dir);
      writeFileSync(join(dir, 'theme.css'), '#probe { color: rgb(0, 128, 0); }');
      writeFileSync(join(dir, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
    }
    for (const [index, [name, html, expectedDirectory, compatMode]] of cases.entries()) {
      await t.test(name, async () => {
        let observed;
        const output = join(root, `cv-${index}.pdf`);
        await renderHtmlToPdf(html, output, {
          workspaceRoot: root, baseDir: inputDir, noClobber: true, format: 'a4',
          launchBrowser: async () => ({
            async newContext(options) {
              const context = await browser.newContext(options);
              const newPage = context.newPage.bind(context);
              context.newPage = async () => {
                const page = await newPage();
                const pdf = page.pdf.bind(page);
                page.pdf = async options => {
                  observed = await page.evaluate(() => ({
                    base: document.baseURI,
                    image: document.querySelector('#photo').naturalWidth,
                    color: getComputedStyle(document.querySelector('#probe')).color,
                    compatMode: document.compatMode,
                    scriptRan: window.ran === true,
                  }));
                  return pdf(options);
                };
                return page;
              };
              return context;
            },
            async close() {}, // The suite owns this shared browser.
          }),
        });
        assert.deepEqual(observed, {
          base: pathToFileURL(expectedDirectory + '/').href,
          image: 1, color: 'rgb(0, 128, 0)', compatMode, scriptRan: false,
        });
        assert.equal(readFileSync(output).subarray(0, 5).toString(), '%PDF-');
      });
    }
  } finally {
    await browser.close();
    rmSync(root, { recursive: true, force: true });
  }
});
