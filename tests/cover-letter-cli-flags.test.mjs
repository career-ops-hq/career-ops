// tests/cover-letter-cli-flags.test.mjs — generate-cover-letter.mjs flags (#6373).
//
// main() parsed its flags with `strict: false`, which caused three problems:
//   - an unknown flag was dropped silently. That included --max-pages and
//     --strict-pages, which the script never declared, so a five-page letter
//     shipped under the CV's 2-page warning-only budget, with a "CV is 5 pages"
//     message;
//   - a string flag with no value took the next flag as its value:
//     `--report --out x.pdf` set report to "--out", and the PDF went to the
//     default path;
//   - a typo such as --reprot 42 was accepted and did nothing.
// The parser is now strict, validates --report and --max-pages, and passes the
// page budget to the renderer. The default budget for a cover letter is 1 page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCoverArgs, DEFAULT_COVER_MAX_PAGES } from '../generate-cover-letter.mjs';
import { enforcePageBudget } from '../generate-pdf.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAPTURE_REGISTER = fileURLToPath(new URL('./fixtures/cover-pdf-capture-register.mjs', import.meta.url));

const rejects = (argv, pattern) => {
  const res = parseCoverArgs(argv);
  assert.equal(res.ok, false, `${argv.join(' ')} should be rejected`);
  assert.match(res.error, pattern, argv.join(' '));
};

test('an unknown flag is rejected, not dropped', () => {
  rejects(['--payload', 'p.json', '--reprot', '42'], /reprot/);
  rejects(['--payload', 'p.json', '--max-page=1'], /max-page/);
});

test('a valueless --report does not swallow the next flag', () => {
  rejects(['--payload', 'p.json', '--report', '--out', 'x.pdf'], /report/);
});

test('a valueless --out is rejected, not read as boolean true', () => {
  rejects(['--payload', 'p.json', '--out'], /out/);
});

test('an empty --out= is rejected, not read as "no override"', () => {
  rejects(['--payload', 'p.json', '--out='], /Invalid --out/);
  rejects(['--payload', 'p.json', '--out=  '], /Invalid --out/);
});

test('a stray positional argument is rejected', () => {
  rejects(['--payload', 'p.json', 'extra.pdf'], /extra\.pdf|positional/i);
});

test('--report takes digits only', () => {
  for (const bad of ['--report=abc', '--report=', '--report=4x', '--report=-1', '--report= 42 ', '--report=42\n']) {
    rejects(['--payload', 'p.json', bad], /Invalid --report/);
  }
  const ok = parseCoverArgs(['--payload', 'p.json', '--report=042']);
  assert.equal(ok.ok, true);
  assert.equal(ok.args.report, '042');
});

test('--max-pages takes a positive integer', () => {
  for (const bad of ['--max-pages=0', '--max-pages=1.5', '--max-pages=two', '--max-pages=']) {
    rejects(['--payload', 'p.json', bad], /Invalid --max-pages/);
  }
  const ok = parseCoverArgs(['--payload', 'p.json', '--max-pages=2', '--strict-pages']);
  assert.equal(ok.ok, true);
  assert.equal(ok.args.maxPages, 2);
  assert.equal(ok.args.strictPages, true);
});

test('a cover letter defaults to a 1-page warning-only budget', () => {
  const ok = parseCoverArgs(['--payload', 'p.json']);
  assert.equal(ok.ok, true);
  assert.equal(DEFAULT_COVER_MAX_PAGES, 1);
  assert.equal(ok.args.maxPages, 1);
  assert.equal(ok.args.strictPages, false);
});

test('the existing flags still parse', () => {
  const ok = parseCoverArgs(['--payload', 'p.json', '--out', 'output/x.pdf', '--format=a4', '--country', 'DE', '--report', '7']);
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.args.out, 'output/x.pdf');
  assert.equal(ok.args.format, 'a4');
  assert.equal(ok.args.country, 'DE');
  assert.equal(ok.args.report, '7');
});

test('an overflowing cover letter is reported as a cover letter, not a CV', () => {
  assert.throws(
    () => enforcePageBudget(3, { maxPages: 1, strictPages: true, kind: 'cover' }),
    (err) => /^Cover letter is 3 pages; the allowed maximum is 1 page\./.test(err.message) && !/\bCV\b/.test(err.message),
  );
  // The CV wording is unchanged.
  assert.throws(() => enforcePageBudget(3, { maxPages: 2, strictPages: true }), (err) => err.message.startsWith('CV is 3 pages'));
});

function runCover(flags, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-flags-'));
  mkdirSync(join(dir, 'output'));
  writeFileSync(join(dir, 'cv.md'), 'Avery Quinn builds ledger services.\n');
  const payloadPath = join(dir, 'payload.json');
  const capture = join(dir, 'capture.json');
  writeFileSync(payloadPath, JSON.stringify({
    candidate: { name: 'Avery Quinn', email: 'avery.quinn@example.com' },
    letter: { role_title: 'Engineer', opening: 'Opening line.', profile_intro: 'Profile intro.' },
    output_path: 'output/letter.pdf',
  }));
  const res = spawnSync(process.execPath, [
    '--import', pathToFileURL(CAPTURE_REGISTER).href,
    join(ROOT, 'generate-cover-letter.mjs'),
    '--payload', payloadPath,
    ...flags,
  ], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', COVER_PDF_CAPTURE: capture, ...extraEnv },
  });
  const captured = existsSync(capture) ? JSON.parse(readFileSync(capture, 'utf-8')) : null;
  const outputFiles = readdirSync(join(dir, 'output'));
  rmSync(dir, { recursive: true, force: true });
  return { ...res, captured, outputFiles };
}

test('CLI: a bad flag exits 1 before rendering anything', () => {
  for (const flags of [['--reprot', '42'], ['--report', '--out', 'x.pdf'], ['--out']]) {
    const res = runCover(flags);
    assert.equal(res.status, 1, `${flags.join(' ')}\n${res.stdout}${res.stderr}`);
    assert.equal(res.captured, null, `${flags.join(' ')} must not reach the renderer`);
    assert.deepEqual(res.outputFiles, []);
    assert.match(res.stderr, /Usage:/);
  }
});

test('CLI: --max-pages and --strict-pages reach the renderer', () => {
  const res = runCover(['--max-pages=2', '--strict-pages', '--report=12']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.captured.opts.maxPages, 2);
  assert.equal(res.captured.opts.strictPages, true);
  assert.equal(res.captured.opts.reportNum, '12');
  assert.equal(res.captured.opts.kind, 'cover');
});

test('CLI: an overflow reports its draft path instead of a nonexistent final PDF', () => {
  const res = runCover([], { COVER_PDF_SIMULATE_OVERFLOW: '1' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Cover letter over its page budget:/);
  assert.match(res.stdout, /draft is .*letter\.pdf\.overflow\.pdf/);
  assert.doesNotMatch(res.stdout, /Cover letter PDF:/);
});

test('strict cover-letter budget error never recommends CV-only settings', () => {
  assert.throws(
    () => enforcePageBudget(2, { kind: 'cover', maxPages: 1, strictPages: true }),
    (err) => err.message.includes('--strict-pages') && !err.message.includes('cv.strict_pages'),
  );
  assert.throws(
    () => enforcePageBudget(3, { maxPages: 2, strictPages: true }),
    /cv\.strict_pages/,
  );
});

test('CLI: with no page flags the renderer gets the 1-page warning-only default', () => {
  const res = runCover([]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.captured.opts.maxPages, 1);
  assert.equal(res.captured.opts.strictPages, false);
});

// The unit test above calls enforcePageBudget directly. This one goes through
// the real renderHtmlToPdf, with a stub browser (no Chromium needed) whose PDF
// reports two pages, so it proves the cover kind reaches the budget message
// on the path generate-cover-letter.mjs actually uses (CodeRabbit on #6384).
test('renderHtmlToPdf reports an overflowing cover letter as a cover letter', () => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-cover-budget-')));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'output'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications Tracker\n');
  const src = `
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const [root, dataRoot] = process.argv.slice(1);
    const { renderHtmlToPdf } = await import(pathToFileURL(join(root, 'generate-pdf.mjs')).href);
    const stubBrowser = async () => ({
      async newPage() {
        return {
          async goto() {},
          async evaluate() {},
          async pdf() {
            return Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n'
              + '2 0 obj\\n<< /Type /Pages /Count 2 >>\\nendobj\\n%%EOF');
          },
        };
      },
      async close() {},
    });
    try {
      await renderHtmlToPdf('<!doctype html><html><body><p>Dear team,</p></body></html>',
        join(dataRoot, 'output', 'letter-cover.pdf'),
        { kind: 'cover', maxPages: 1, strictPages: true, launchBrowser: stubBrowser });
      console.log('RESULT ' + JSON.stringify({ threw: false }));
    } catch (err) {
      console.log('RESULT ' + JSON.stringify({ threw: true, message: err.message }));
    }
  `;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src, ROOT, dataRoot], {
      cwd: dataRoot,
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PDF_INDEX: '', CAREER_OPS_PDF_SHARED: '' },
    });
    const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, `no RESULT line:\n${r.stdout}${r.stderr}`);
    const got = JSON.parse(line.slice('RESULT '.length));
    assert.equal(got.threw, true, 'a strict 2-page cover letter over a 1-page budget must throw');
    assert.ok(got.message.startsWith('Cover letter is 2 pages; the allowed maximum is 1 page.'), got.message);
    assert.doesNotMatch(got.message, /\bCV\b/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
