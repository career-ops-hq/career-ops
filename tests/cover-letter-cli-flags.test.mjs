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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('a stray positional argument is rejected', () => {
  rejects(['--payload', 'p.json', 'extra.pdf'], /extra\.pdf|positional/i);
});

test('--report takes digits only', () => {
  for (const bad of ['--report=abc', '--report=', '--report=4x', '--report=-1']) {
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

function runCover(flags) {
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
    '--import', CAPTURE_REGISTER,
    join(ROOT, 'generate-cover-letter.mjs'),
    '--payload', payloadPath,
    ...flags,
  ], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', COVER_PDF_CAPTURE: capture },
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

test('CLI: with no page flags the renderer gets the 1-page warning-only default', () => {
  const res = runCover([]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.captured.opts.maxPages, 1);
  assert.equal(res.captured.opts.strictPages, false);
});
