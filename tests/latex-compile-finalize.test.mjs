// tests/latex-compile-finalize.test.mjs -- generate-latex.mjs fails the run when
// the PDF never reaches the output path, and cleans up its patched .tex.
//
// A compile that succeeded but could not copy the PDF to the target only set
// postCompileError: `compiled` stayed true and the CLI exited 0 with no PDF at
// the output path. And a failed tectonic compile left `{base}._tectonic.tex`
// in the user's directory, because it was deleted only on success.
//
// The script is copied into a temp workspace with a fake `tectonic` beside it,
// which resolveLatexEngine() prefers as the repo-local engine, so no real TeX
// engine is needed. The fake is a shebang script, so the suite skips on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT_FILES = ['generate-latex.mjs', 'path-resolver.mjs', 'lib/cli-flags.mjs', 'lib/is-main-module.mjs'];
const TEX = '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n';

// Answers --version, then either writes {outdir}/{base}.pdf or fails like a
// LaTeX error, as FAKE_TECTONIC says.
const FAKE_TECTONIC = `#!${process.execPath}
const { writeFileSync } = require('fs');
const { basename, join } = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('tectonic 0.0.0-fake');
} else if (process.env.FAKE_TECTONIC === 'fail') {
  console.error('! Undefined control sequence.');
  process.exitCode = 1;
} else {
  const outdir = args[args.indexOf('--outdir') + 1];
  const input = args[args.length - 1];
  writeFileSync(join(outdir, basename(input, '.tex') + '.pdf'), '%PDF-1.4 fake');
}
`;

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'latex-finalize-'));
  for (const file of SCRIPT_FILES) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(dir, file));
  }
  const fake = join(dir, 'tectonic');
  writeFileSync(fake, FAKE_TECTONIC);
  chmodSync(fake, 0o755);
  const work = join(dir, 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'cv.tex'), TEX);
  return { dir, work };
}

function runLatex(dir, args, mode) {
  const result = spawnSync(process.execPath, [join(dir, 'generate-latex.mjs'), ...args, '--compile-only', '--skip-fact-check'], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, FAKE_TECTONIC: mode },
  });
  assert.equal(result.error, undefined, `generate-latex.mjs failed to spawn: ${result.error?.message}`);
  return { ...result, report: JSON.parse(result.stdout) };
}

const skip = process.platform === 'win32' && 'the fake tectonic is a shebang script';

test('a successful fake compile exits 0 with the PDF at the target', { skip }, () => {
  const { dir, work } = makeWorkspace();
  try {
    const target = join(work, 'out.pdf');
    const result = runLatex(dir, [join(work, 'cv.tex'), target], 'ok');
    assert.equal(result.status, 0, describeSpawn(result, 'want exit 0'));
    assert.equal(result.report.engine, 'tectonic');
    assert.equal(result.report.compiled, true);
    assert.equal(result.report.pdf.path, target);
    assert.ok(existsSync(target), 'no PDF at the target');
    assert.deepEqual(readdirSync(work).sort(), ['cv.tex', 'out.pdf']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a PDF that cannot be copied to the target fails the run', { skip }, () => {
  const { dir, work } = makeWorkspace();
  try {
    // A directory at the output path makes the copy fail after the engine ran.
    const target = join(work, 'out.pdf');
    mkdirSync(target);
    const result = runLatex(dir, [join(work, 'cv.tex'), target], 'ok');
    assert.equal(result.status, 1, describeSpawn(result, 'a finalize failure exited 0'));
    assert.equal(result.report.compiled, false);
    assert.equal(result.report.pdf, undefined);
    assert.match(result.report.postCompileError, /^Failed to finalize PDF: /);
    assert.match(result.stderr, /Failed to finalize PDF: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed tectonic compile removes the patched ._tectonic.tex', { skip }, () => {
  const { dir, work } = makeWorkspace();
  try {
    const result = runLatex(dir, [join(work, 'cv.tex')], 'fail');
    assert.equal(result.status, 1, describeSpawn(result, 'a failed compile exited 0'));
    assert.equal(result.report.compiled, false);
    assert.ok(result.report.compileError, 'no compileError reported');
    assert.ok(!existsSync(join(work, 'cv._tectonic.tex')), 'cv._tectonic.tex was left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
