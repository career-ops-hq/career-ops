import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceText = String.raw`\documentclass{article}
\newcommand{\resumeSubheading}[4]{}
\newcommand{\resumeItem}[1]{\item #1}
\begin{document}
\resumeSubheading{Fictional Corp}{2024}{Engineer}{Remote}
\begin{itemize}
\resumeItem{Original source bullet.}
\end{itemize}
\end{document}
`;
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'latex-extract-output-'));
  const source = join(root, 'source.tex');
  writeFileSync(source, sourceText);
  const run = args => spawnSync(process.execPath, [join(ROOT, 'extract-latex-content.mjs'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  try { fn({ root, source, run }); }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
}
for (const alias of ['same path', 'relative path', 'hard link', 'symbolic link']) {
  test(`manifest output through ${alias} preserves the LaTeX source`, { skip: alias === 'symbolic link' && process.platform === 'win32' }, () => fixture(({ root, source, run }) => {
    let output = source;
    if (alias === 'relative path') output = './source.tex';
    if (alias === 'hard link' || alias === 'symbolic link') {
      output = join(root, 'manifest.json');
      (alias === 'hard link' ? linkSync : symlinkSync)(source, output);
    }
    const result = run([source, '--out', output]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /output.*source|source.*output/i);
    assert.equal(readFileSync(source, 'utf8'), sourceText);
    assert.equal(readFileSync(alias === 'relative path' ? source : output, 'utf8'), sourceText);
  }));
}
for (const existing of [false, true]) {
  test(`a separate ${existing ? 'existing' : 'new'} manifest is written without changing its source`, () => fixture(({ root, source, run }) => {
    const output = join(root, 'manifest.json');
    if (existing) writeFileSync(output, 'old manifest');
    const result = run([source, '--out', output]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(manifest.supported, true);
    assert.equal(manifest.slots[0].text, 'Original source bullet.');
    assert.deepEqual(JSON.parse(result.stdout), manifest);
    assert.equal(readFileSync(source, 'utf8'), sourceText);
  }));
}
test('stdout extraction preserves the source', () => fixture(({ source, run }) => {
  const result = run([source]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).supported, true);
  assert.equal(readFileSync(source, 'utf8'), sourceText);
}));
