// tests/generate-pdf-manifest-concurrency.test.mjs — concurrent renders do not
// erase each other's rows from data/pdf-index.tsv.
//
// Recording a PDF in the manifest is a read-modify-write of one shared file:
// read the rows, supersede the report's own row, write everything back. It ran
// with no lock and a plain writeFileSync, and every render is a separate
// process — batch-runner.sh --parallel N starts N workers and each one runs
// generate-pdf.mjs. Two renders that read the same manifest each wrote back
// "the old rows plus my own", so whichever wrote last erased the other's row,
// silently: the PDF existed, its manifest row did not, and find.mjs, the
// dashboard and outcome.mjs could no longer locate it.
//
// The children are released together at a shared start time and the manifest is
// seeded with enough rows that a read-modify-write takes long enough to overlap
// for certain, so the unlocked version loses rows on every run instead of once
// in a while. The browser is a test double: no Chromium is started.
//
// Run:  node --test tests/generate-pdf-manifest-concurrency.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GENERATE_PDF_URL = pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href;

const WORKERS = 8;
const SEED_ROWS = 20_000;

const CHILD = `
const [genUrl, outPath, report, workspace, startAt] = process.argv.slice(2);
const { renderHtmlToPdf } = await import(genUrl);
const pdf = Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n'
  + '2 0 obj\\n<< /Type /Pages /Count 1 >>\\nendobj\\n%%EOF');
const launchBrowser = async () => ({
  async newPage() {
    return { async goto() {}, async evaluate() {}, async pdf() { return pdf; } };
  },
  async close() {},
});
const wait = Number(startAt) - Date.now();
if (wait > 0) await new Promise((r) => setTimeout(r, wait));
await renderHtmlToPdf('<!doctype html><html><body>cv</body></html>', outPath, {
  reportNum: report, workspaceRoot: workspace, styleTokens: {}, launchBrowser, kind: 'cv',
});
`;

function runChild(script, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
  });
}

test('parallel renders each keep their manifest row', async () => {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-pdfindex-race-')));
  try {
    const manifest = join(sandbox, 'data', 'pdf-index.tsv');
    mkdirSync(join(sandbox, 'data'), { recursive: true });
    mkdirSync(join(sandbox, 'output'), { recursive: true });
    const seed = ['# report\tpdf\thtml\tformat\tdate\tkind - written by generate-pdf.mjs, do not edit'];
    for (let i = 0; i < SEED_ROWS; i += 1) {
      seed.push(`${100000 + i}\toutput/cv-seed-${i}.pdf\t\tletter\t2026-01-01\tcv`);
    }
    writeFileSync(manifest, `${seed.join('\n')}\n`);

    const script = join(sandbox, 'render-one.mjs');
    writeFileSync(script, CHILD);

    const env = {
      ...process.env,
      CAREER_OPS_ROOT: sandbox,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PDF_INDEX: manifest,
    };
    const startAt = String(Date.now() + 4_000);
    const runs = [];
    for (let i = 0; i < WORKERS; i += 1) {
      const out = join(sandbox, 'output', `cv-worker-${i}.pdf`);
      runs.push(runChild(script, [GENERATE_PDF_URL, out, String(i + 1), sandbox, startAt], env));
    }
    const results = await Promise.all(runs);
    for (const [i, r] of results.entries()) {
      assert.equal(r.code, 0, `worker ${i} exited ${r.code}:\n${r.out}`);
      assert.doesNotMatch(r.out, /Manifest update failed/, `worker ${i} could not record its row:\n${r.out}`);
    }

    const rows = readFileSync(manifest, 'utf-8').split('\n').filter((l) => l && !l.startsWith('#'));
    const written = new Set(rows.map((l) => l.split('\t')[1]));
    const missing = [];
    for (let i = 0; i < WORKERS; i += 1) {
      if (!written.has(`output/cv-worker-${i}.pdf`)) missing.push(i);
    }
    assert.deepEqual(missing, [], `rows lost to a concurrent read-modify-write: workers ${missing.join(', ')}`);
    assert.equal(rows.length, SEED_ROWS + WORKERS, 'every existing row must also survive');
  } finally {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
