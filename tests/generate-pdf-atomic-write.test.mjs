// tests/generate-pdf-atomic-write.test.mjs — re-rendering a PDF replaces the
// file instead of rewriting it in place.
//
// renderInPage wrote the buffer with fs/promises writeFile, which truncates
// the existing PDF before writing. A write that failed partway left an empty
// or partial PDF where the previous good one had been, and pdf-index.tsv kept
// pointing Apply at it. A hard link to the old PDF shows the difference: after
// an atomic replace it still holds the old bytes, after an in-place rewrite it
// holds whatever the new write left behind. A link rather than an open file
// handle, because Windows refuses to rename over a file that is open.
//
// Run:  node --test tests/generate-pdf-atomic-write.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { renderHtmlToPdf } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

const NEW_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
  + '2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n%%EOF');

const launchBrowser = async () => ({
  async newPage() {
    return { async goto() {}, async evaluate() {}, async pdf() { return NEW_PDF; } };
  },
  async close() {},
});

test('re-rendering replaces the previous PDF instead of rewriting it in place', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-pdf-atomic-')));
  try {
    const outDir = join(workspace, 'output');
    mkdirSync(outDir);
    const outPath = join(outDir, 'cv.pdf');
    writeFileSync(outPath, 'previous good pdf');
    const previous = join(outDir, 'cv-previous.pdf');
    linkSync(outPath, previous);
    await renderHtmlToPdf('<!doctype html><html><body>cv</body></html>', outPath, {
      workspaceRoot: workspace,
      format: 'letter',
      launchBrowser,
    });
    assert.equal(readFileSync(previous, 'utf8'), 'previous good pdf');
    assert.deepEqual(readFileSync(outPath), NEW_PDF);
    assert.deepEqual(readdirSync(outDir).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a write that fails partway leaves the previous PDF in place', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-pdf-atomic-')));
  try {
    const outDir = join(workspace, 'output');
    mkdirSync(outDir);
    const outPath = join(outDir, 'cv.pdf');
    writeFileSync(outPath, 'previous good pdf');
    const failingBrowser = async () => ({
      async newPage() {
        return {
          async goto() {},
          async evaluate() {},
          async pdf() {
            return (async function* () {
              yield Buffer.from('%PDF-1.7\n');
              throw new Error('disk full');
            })();
          },
        };
      },
      async close() {},
    });
    await assert.rejects(renderHtmlToPdf('<!doctype html><html><body>cv</body></html>', outPath, {
      workspaceRoot: workspace,
      format: 'letter',
      launchBrowser: failingBrowser,
    }));
    assert.equal(readFileSync(outPath, 'utf8'), 'previous good pdf');
    assert.deepEqual(readdirSync(outDir).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
