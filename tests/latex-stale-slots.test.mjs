import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

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

function check(name, run) {
  try {
    run();
    pass(name);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

function fixture(run, initialText = sourceText) {
  const root = mkdtempSync(join(tmpdir(), 'latex-stale-slots-'));
  try {
    const source = join(root, 'source.tex');
    const manifest = join(root, 'manifest.json');
    const output = join(root, 'output.tex');
    const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' };
    const cli = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
    writeFileSync(source, initialText);
    const extracted = cli('extract-latex-content.mjs', [source, '--out', manifest]);
    assert.equal(extracted.status, 0, describeSpawn(extracted));
    const slots = JSON.parse(readFileSync(manifest, 'utf8')).slots;
    assert.equal(slots.length, 2);
    writeFileSync(manifest, JSON.stringify({ slots, patches: [{ id: slots[0].id, text: 'Tailored 30% & verified.' }] }));
    run({ source, manifest, output, cli });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

check('unchanged extracted source patches only the selected prose and escapes it', () => fixture(({ source, manifest, output, cli }) => {
  const result = cli('patch-latex-content.mjs', [source, manifest, output]);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(readFileSync(source, 'utf8'), sourceText);
  assert.equal(readFileSync(output, 'utf8'), sourceText.replace('Original first bullet.', String.raw`Tailored 30\% \& verified.`));
}));

for (const edit of [text => '% New comment before extraction offsets\n' + text, text => text.replace('Original first bullet.', 'Revised first bullet.')]) {
  check('an edited source refuses stale spans and preserves an existing output', () => fixture(({ source, manifest, output, cli }) => {
    const edited = edit(sourceText);
    writeFileSync(source, edited);
    writeFileSync(output, 'Previous valid output.');
    const result = cli('patch-latex-content.mjs', [source, manifest, output]);
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
    assert.match(result.stderr, /stale|changed/i);
    assert.match(result.stderr, /extract-latex-content/);
    assert.equal(readFileSync(output, 'utf8'), 'Previous valid output.');
    assert.equal(readFileSync(source, 'utf8'), edited);
  }));
}

check('stale spans cannot create a new output artifact', () => fixture(({ source, manifest, output, cli }) => {
  writeFileSync(source, '% Shifted\n' + sourceText);
  const result = cli('patch-latex-content.mjs', [source, manifest, output]);
  assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
  assert.ok(!existsSync(output));
}));


check('fresh unbraced item slots remain valid with trailing spaces and CRLF', () => {
  const initial = String.raw`\documentclass{article}
\usepackage{tabularx}
\begin{document}
\begin{itemize}
\item First bullet.
\item Second bullet.
\end{itemize}
\end{document}
`.replace('First bullet.', 'First bullet.   ').replace('Second bullet.', 'Second bullet. ').replace(/\n/g, '\r\n');
  fixture(({ source, manifest, output, cli }) => {
    const result = cli('patch-latex-content.mjs', [source, manifest, output]);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(readFileSync(output, 'utf8'), /Tailored 30\\% \\& verified\./);
    assert.equal(readFileSync(source, 'utf8'), initial);
  }, initial);
});

for (const existingOutput of [false, true]) {
  check(`duplicate slot IDs cannot ${existingOutput ? 'overwrite an existing' : 'create a new'} output`, () => fixture(({ source, manifest, output, cli }) => {
    const payload = JSON.parse(readFileSync(manifest, 'utf8'));
    payload.slots.push({ ...payload.slots[0], span: payload.slots[1].span });
    writeFileSync(manifest, JSON.stringify(payload));
    if (existingOutput) writeFileSync(output, 'Previous valid output.');
    const result = cli('patch-latex-content.mjs', [source, manifest, output]);
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
    assert.match(result.stderr, /duplicate slot ids/i);
    assert.equal(readFileSync(source, 'utf8'), sourceText);
    if (existingOutput) assert.equal(readFileSync(output, 'utf8'), 'Previous valid output.');
    else assert.ok(!existsSync(output));
  }));
}
