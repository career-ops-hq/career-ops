// tests/cover-letter-data-root.test.mjs: with the data root outside the
// checkout, the cover letter PDF lands in the data root (#4314).
//
// generate-cover-letter.mjs anchored OUTPUT_ROOT to its own directory, while
// the PDF guard in generate-pdf.mjs bounds every write by the tracker
// workspace, which is the data root (#4389). With CAREER_OPS_ROOT set the two
// could not both be satisfied: `--out output/x.pdf` resolved into
// <checkout>/output and the render refused it, and an absolute path under the
// data root was refused by the cover letter's own guard first. No cover letter
// could be produced at all.
//
// Siblings: the CV side of generate-pdf.mjs is covered under an external data
// root by tests/writer-scripts-data-root.test.mjs, and doctor's code-layer
// checks by tests/doctor-code-root-checks.test.mjs.
//
// Each child runs with CAREER_OPS_ROOT set and the cwd pointed at a different
// directory, so a path following the cwd or the checkout cannot pass by
// accident. The render goes through renderHtmlToPdf's launchBrowser seam with a
// stub browser: no Chromium is needed (the CI test job installs none), while
// the real containment guard, the PDF write and the manifest update all run.
//
// Run:  node --test tests/cover-letter-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Unique per run: the checkout's own output/ is asserted to stay untouched, and
// a fixed name could collide with a real file there.
const PROBE = `cover-data-root-probe-${process.pid}.pdf`;

function fixture() {
  // realpathSync because generate-pdf.mjs compares canonical paths, and on
  // macOS the temp dir is reached through a symlink (/var -> /private/var).
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-coverroot-')));
  const decoyCwd = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-covercwd-')));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'output'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications Tracker\n');
  return { dataRoot, decoyCwd };
}

function cleanup(f) {
  for (const d of [f.dataRoot, f.decoyCwd]) {
    rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  // Only ever present if the guard regressed and wrote into the checkout.
  rmSync(join(ROOT, 'output', PROBE), { force: true });
}

// Runs `body` as an ES module in a child whose data root is f.dataRoot. The
// body prints one `RESULT <json>` line; everything else is the scripts' own log.
function runChild(body, f) {
  const src = `
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const [root, dataRoot, probe] = process.argv.slice(1);
    const load = (file) => import(pathToFileURL(join(root, file)).href);
    ${body}
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src, ROOT, f.dataRoot, PROBE], {
    cwd: f.decoyCwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: f.dataRoot,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PDF_INDEX: '',
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  const all = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 0, `the child exited ${r.status}:\n${all.slice(0, 800)}`);
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `the child printed no RESULT line:\n${all.slice(0, 800)}`);
  return JSON.parse(line.slice('RESULT '.length));
}

test('the cover letter resolves output/ under the data root, not the checkout or the cwd', () => {
  const f = fixture();
  try {
    const got = runChild(`
      const { safeOutputPath } = await load('generate-cover-letter.mjs');
      const attempt = (raw) => {
        try { return { path: safeOutputPath(raw) }; } catch (err) { return { refused: err.message }; }
      };
      console.log('RESULT ' + JSON.stringify({
        relative: attempt('output/' + probe),
        bare: attempt(probe),
        absolute: attempt(join(dataRoot, 'output', 'bundle', 'v1', probe)),
        checkout: attempt(join(root, 'output', probe)),
      }));
    `, f);
    const expected = join(f.dataRoot, 'output', PROBE);
    assert.deepEqual(got.relative, { path: expected }, '--out output/<file> must resolve into the data root');
    assert.deepEqual(got.bare, { path: expected }, 'a bare filename must land in the data root output/');
    assert.deepEqual(got.absolute, { path: join(f.dataRoot, 'output', 'bundle', 'v1', PROBE) },
      'an absolute path inside the data root output/ must be accepted as written');
    assert.match(got.checkout?.refused ?? '', /Refusing to write the cover letter outside output\//,
      `the checkout's output/ is code layer here and must be refused, got ${JSON.stringify(got.checkout)}`);
  } finally { cleanup(f); }
});

test('the cover letter PDF renders into the data root through the generate-pdf guard', () => {
  const f = fixture();
  try {
    const got = runChild(`
      const { safeOutputPath } = await load('generate-cover-letter.mjs');
      const { renderHtmlToPdf } = await load('generate-pdf.mjs');
      // The same two steps generate-cover-letter.mjs main() runs after its
      // fact gate: safeOutputPath() on --out, then renderHtmlToPdf().
      const target = safeOutputPath('output/' + probe);
      const stubBrowser = async () => ({
        async newPage() {
          return {
            async goto() {},
            async evaluate() {},
            async pdf() {
              return Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n'
                + '2 0 obj\\n<< /Type /Pages /Count 1 >>\\nendobj\\n%%EOF');
            },
          };
        },
        async close() {},
      });
      const result = await renderHtmlToPdf(
        '<!doctype html><html><body><p>Dear hiring team,</p></body></html>',
        target,
        { inputPath: join(dataRoot, 'cover-payload.json'), launchBrowser: stubBrowser },
      );
      console.log('RESULT ' + JSON.stringify({ outputPath: result.outputPath }));
    `, f);
    const expected = join(f.dataRoot, 'output', PROBE);
    assert.equal(got.outputPath, expected, 'the PDF was not written to the data root output/');
    assert.ok(readFileSync(expected, 'latin1').startsWith('%PDF'), 'no PDF bytes at the data root path');

    // The manifest lives in the data root and records the PDF relative to it.
    const manifest = readFileSync(join(f.dataRoot, 'data', 'pdf-index.tsv'), 'utf-8');
    assert.ok(manifest.split('\n').some((row) => row.split('\t')[1] === `output/${PROBE}`),
      `no data-root-relative manifest row for the cover letter:\n${manifest}`);

    assert.ok(!existsSync(join(ROOT, 'output', PROBE)), 'wrote the cover letter into the checkout output/');
    assert.ok(!existsSync(join(f.decoyCwd, 'output')), 'created output/ in the cwd');
  } finally { cleanup(f); }
});
