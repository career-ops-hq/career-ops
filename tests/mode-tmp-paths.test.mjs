// tests/mode-tmp-paths.test.mjs — mode docs and script help-text must not
// point transient payloads at the OS temp directory.
//
// Agent harnesses with directory-scoped write approval stop and ask before
// every write outside the checkout, so a `/tmp/cv-….json` in a mode file
// costs the user a confirmation on a file the next command consumes and
// nothing ever reads again. The convention is the checkout-root `tmp/` dir —
// gitignored, same rule as the existing `batch/tmp/` worker scratch — with
// `CAREER_OPS_TMPDIR` as the escape hatch for whoever wants temp elsewhere.
// This test pins the converted files so a future edit cannot quietly
// reintroduce an absolute temp path.
//
// Deliberately out of scope here (checked elsewhere or justified in place):
// os.tmpdir() self-test fixtures and tracker lock dirs (kept on OS temp by
// design), and the one-shot mktemp relocation blocks in modes/oferta.md +
// batch/batch-prompt.md (security-justified, runtime paths that never appear
// as literals an agent is told to type).
//
// Run:  node --test tests/mode-tmp-paths.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Files whose prose/CLI text an agent acts on directly. A `/tmp/` literal
// here is an instruction to write outside the checkout.
const CONVERTED = [
  'modes/pdf.md',
  'modes/latex.md',
  'modes/latex-tex.md',
  'modes/cover.md',
  'modes/add.md',
  'modes/discover.md',
  'modes/batch.md',
  'modes/pdf/hm-audit.md',
  'cv-title-check.mjs',
  'discover-new-companies.mjs',
  'keyword-match.mjs',
];

// A line is fine when the /tmp/ sits inside a mktemp/TMPDIR expression the
// agent runs rather than a literal path it is told to write to.
const isExcused = (line) => /mktemp|\$\{?TMPDIR|os\.tmpdir|tmpdir\(\)/.test(line);

for (const rel of CONVERTED) {
  test(`${rel} points transient payloads at repo-local tmp/, not /tmp/`, () => {
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    const bad = src.split('\n')
      .map((line, i) => ({ line, i: i + 1 }))
      // `batch/tmp/` is repo-local — only match /tmp/ not preceded by a word char.
      .filter(({ line }) => /(^|[^\w])\/tmp\//.test(line) && !isExcused(line));
    assert.deepEqual(
      bad.map(({ i, line }) => `${i}: ${line.trim()}`).slice(0, 5),
      [],
      `${rel} still references OS temp in ${bad.length} line(s) — use checkout-root tmp/ instead.`,
    );
  });
}

test('checkout-root tmp/ is gitignored so payloads never leak into commits', () => {
  const ignore = existsSync(join(ROOT, '.gitignore'))
    ? readFileSync(join(ROOT, '.gitignore'), 'utf-8')
    : '';
  assert.match(
    ignore,
    /^tmp\/\*$/m,
    '.gitignore must cover tmp/* — mode files now direct payloads there.',
  );
  assert.match(
    ignore,
    /^!tmp\/\.gitkeep$/m,
    '.gitignore must except tmp/.gitkeep — the directory has to exist in fresh checkouts.',
  );
});

test('tmp/.gitkeep is tracked so the payload directory exists on clone', () => {
  assert.ok(
    existsSync(join(ROOT, 'tmp', '.gitkeep')),
    'tmp/.gitkeep must ship with the repo — agents write tmp/ payloads into it directly.',
  );
});
