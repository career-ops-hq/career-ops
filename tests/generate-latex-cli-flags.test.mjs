// tests/generate-latex-cli-flags.test.mjs -- CLI flag validation for
// generate-latex.mjs.
//
// main() consumed every argv token that was not --compile-only as a PATH, so an
// unrecognized flag never fell through to a default: it became a filename.
// `--help` was resolved as the input .tex and reported as a missing file, and a
// mistyped `--compileonly` became the OUTPUT path while the template validation
// it was meant to skip ran anyway.
//
// These cases all exit before any LaTeX engine is needed, so the suite does not
// require tectonic or pdflatex on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'generate-latex.mjs');
const VALID_FLAGS = ['--compile-only', '--help', '-h'];

function runLatex(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `generate-latex.mjs failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `generate-latex.mjs was killed by ${result.signal} (timeout?)`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('generate-latex help prints usage instead of reading a file named --help', () => {
  for (const flag of ['--help', '-h']) {
    const result = runLatex(flag);

    assert.equal(result.status, 0, `${flag} exited ${result.status}, want 0`);
    assert.match(result.stdout, /Usage:/i, `${flag} printed no usage block`);
    assert.match(result.stdout, /node generate-latex\.mjs/, `${flag} did not identify the command`);
    assert.doesNotMatch(result.all, /Error reading/i, `${flag} was still treated as an input path`);
    assert.doesNotMatch(result.all, /ENOENT/i, `${flag} was still resolved as a filename`);
  }
});

test('generate-latex rejects an unrecognized flag and lists the valid flags', () => {
  const result = runLatex('cv.tex', '--no-such-flag');

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /unrecognized flag\(s\): --no-such-flag/i);
  for (const flag of VALID_FLAGS) {
    assert.ok(result.all.includes(flag), `valid flag ${flag} was not listed`);
  }
});

test('generate-latex rejects a mistyped --compile-only rather than using it as the output path', () => {
  const result = runLatex('cv.tex', '--compileonly');

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /unrecognized flag\(s\): --compileonly/i);
});

test('generate-latex rejects an unrecognized flag before handling help', () => {
  const result = runLatex('--help', '--no-such-flag');

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /unrecognized flag\(s\): --no-such-flag/i);
  assert.doesNotMatch(result.stdout, /Usage:/i, 'help hid the unrecognized flag error');
});

test('generate-latex prints the usage block when no input path is given', () => {
  const result = runLatex();

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /Usage:/i, 'missing-input error printed no usage block');
  assert.match(result.all, /--compile-only/, 'missing-input usage omitted the real flag');
});

test('generate-latex still accepts --compile-only', () => {
  const result = runLatex('definitely-not-a-real-file.tex', '--compile-only');

  assert.notEqual(result.status, 0, 'a missing input file should not succeed');
  assert.doesNotMatch(result.all, /unrecognized flag/i, '--compile-only was rejected as unknown');
  assert.match(result.all, /Error reading/i, 'expected the missing input file to be reported');
});
