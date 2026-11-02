import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';
import { applyPatches, buildManifest } from '../lib/latex-content.mjs';

const sourceText = String.raw`\documentclass{article}
\newcommand{\resumeSubheading}[4]{}
\newcommand{\resumeItem}[1]{\item #1}
\begin{document}
\resumeSubheading{Corp}{2024}{Engineer}{Remote}
\begin{itemize}
\resumeItem{Original first bullet.}
\resumeItem{Original second bullet.}
\end{itemize}
\end{document}
`;

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

for (const destination of ['new', 'existing', 'source']) {
  check(`duplicate patches cannot corrupt the ${destination} LaTeX destination`, () => {
    const root = mkdtempSync(join(tmpdir(), 'latex-duplicate-patches-'));
    try {
      const source = join(root, 'source.tex');
      const output = destination === 'source' ? source : join(root, 'output.tex');
      const input = join(root, 'patches.json');
      const { slots } = buildManifest(source, sourceText);
      writeFileSync(source, sourceText);
      if (destination === 'existing') writeFileSync(output, 'Previous valid CV.');
      writeFileSync(input, JSON.stringify({ slots, patches: [
        { id: slots[0].id, text: 'A much longer replacement with verified experience.' },
        { id: slots[0].id, text: 'Short.' },
      ] }));
      const result = spawnSync(process.execPath, ['patch-latex-content.mjs', source, input, output], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /duplicate patch/i);
      assert.equal(readFileSync(source, 'utf8'), sourceText);
      if (destination === 'new') assert.ok(!existsSync(output));
      if (destination === 'existing') assert.equal(readFileSync(output, 'utf8'), 'Previous valid CV.');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

check('the patch API rejects repeated IDs before using stale replacement offsets', () => {
  const { slots } = buildManifest('source.tex', sourceText);
  assert.throws(() => applyPatches(sourceText, [
    { id: slots[0].id, text: 'Long replacement with an entirely different length.' },
    { id: slots[0].id, text: 'Short.' },
  ], slots), /duplicate patch/i);
});

check('distinct patches still replace their own prose exactly once', () => {
  const { slots } = buildManifest('source.tex', sourceText);
  const result = applyPatches(sourceText, [{ id: slots[0].id, text: 'First.' }, { id: slots[1].id, text: 'Second.' }], slots);
  assert.equal(result, sourceText.replace('Original first bullet.', 'First.').replace('Original second bullet.', 'Second.'));
});
