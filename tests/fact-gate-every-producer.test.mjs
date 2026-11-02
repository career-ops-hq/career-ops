// tests/fact-gate-every-producer.test.mjs — every path that produces a CV runs
// the fact gate (#5348).
//
// pdf mode ran verify-cv-facts.mjs and generate-pdf.mjs gated again in code,
// while the latex, latex-tex and text modes, which hand the user an equally
// sendable CV, ran nothing: generate-latex.mjs had no gate and text mode had no
// gate step. This suite enumerates the producers instead of naming them, so a
// mode or a renderer added later without the gate fails here.
//
// Two enumerations:
//   - modes: every mode file with a step that builds or writes a CV must also
//     invoke the gate, directly or through a renderer that runs it;
//   - scripts: every script that renders a PDF must import verify-cv-facts.mjs,
//     unless it renders something that is not a candidate-facing document.
// Then generate-latex.mjs, the renderer that had no gate, is run for real.
//
// Run:  node --test tests/fact-gate-every-producer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// A step that builds or writes a CV. `--preview` and `--test` produce nothing
// to send.
const PRODUCER_RE = /node (?:build-cv-html|build-cv-latex|patch-latex-content)\.mjs (?!--preview|--test)|Write to `output\/cv-/;
// The gate itself, or a renderer that runs it before writing its output.
const GATE_RE = /node (?:verify-cv-facts|generate-pdf|generate-latex)\.mjs/;
// Renderers that run the gate in code. Asserted below, so this list cannot
// claim a renderer gates when it does not.
const GATED_RENDERERS = ['generate-pdf.mjs', 'generate-latex.mjs', 'generate-cover-letter.mjs'];

// Forward slashes on every platform: relative() gives `modes\pdf.md` on Windows.
const repoPath = (path) => relative(ROOT, path).split(sep).join('/');
const modeFiles = () => listTree(join(ROOT, 'modes'), { match: /\.md$/ });

test('every mode that builds or writes a CV runs the fact gate', () => {
  const producers = modeFiles().filter(path => PRODUCER_RE.test(readFileSync(path, 'utf-8')));
  const names = producers.map(repoPath);
  for (const expected of ['modes/pdf.md', 'modes/latex.md', 'modes/latex-tex.md', 'modes/text.md', 'modes/ats.md']) {
    assert.ok(names.includes(expected), `the producer scan no longer finds ${expected}; fix PRODUCER_RE before trusting this test`);
  }
  const ungated = producers.filter(path => !GATE_RE.test(readFileSync(path, 'utf-8')));
  assert.deepEqual(ungated.map(repoPath), [], 'these modes produce a CV with no fact gate step');
});

// Scripts that render a PDF of something that is not a candidate-facing
// document, each with the reason.
const NOT_CANDIDATE_DOCUMENTS = new Map([
  ['archive-posting.mjs', 'archives a job posting the candidate is reading, not a document they send'],
  ['img-to-pdf.mjs', 'converts images the user supplies, and writes no text of its own'],
  ['install-latex-engine.mjs', 'installs tectonic; it renders nothing'],
  ['test-all.mjs', 'the test runner'],
]);
const RENDERS_PDF_RE = /\.pdf\(|\bpdflatex\b|\btectonic\b|renderHtmlToPdf/;
const IMPORTS_GATE_RE = /from\s+['"]\.\/verify-cv-facts\.mjs['"]|import\(\s*['"]\.\/verify-cv-facts\.mjs['"]\s*\)/;

test('every script that renders a candidate-facing PDF imports the fact gate', () => {
  const renderers = readdirSync(ROOT)
    .filter(name => name.endsWith('.mjs') && !NOT_CANDIDATE_DOCUMENTS.has(name))
    .filter(name => RENDERS_PDF_RE.test(readFileSync(join(ROOT, name), 'utf-8')));
  assert.deepEqual([...renderers].sort(), [...GATED_RENDERERS].sort(),
    'a script renders a PDF without being listed as gated or as not a candidate document');
  for (const name of renderers) {
    assert.match(readFileSync(join(ROOT, name), 'utf-8'), IMPORTS_GATE_RE, `${name} renders a PDF and never imports verify-cv-facts.mjs`);
  }
  for (const name of NOT_CANDIDATE_DOCUMENTS.keys()) {
    assert.ok(existsSync(join(ROOT, name)), `${name} is exempted but no longer exists; drop it from the list`);
  }
});

// ── generate-latex.mjs, run for real ──────────────────────

const CV = `# Jane Doe

## Experience

### Acme Corp — Remote
**Senior Software Engineer**
2019 – 2024

- Led a team of 4 engineers.
- Reduced latency by 15%.
`;
const tex = (company, bullet) => String.raw`\documentclass{article}
\begin{document}
\section{Experience}
\resumeSubheading
  {${company}}{2019 - 2024}
  {Senior Software Engineer}{Remote}
\resumeItem{${bullet}}
\end{document}
`;

function workspace({ withCv = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-latex-gate-'));
  mkdirSync(join(root, 'output'));
  if (withCv) writeFileSync(join(root, 'cv.md'), CV);
  return root;
}

// Windows spells it `Path`, and its environment keys are case-insensitive, so
// adding `PATH` beside the inherited one leaves which of the two wins undefined.
function envWithoutPath() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
}

function runLatex(root, ...args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), ...args], {
    cwd: root,
    encoding: 'utf-8',
    timeout: 30_000,
    // No engine on PATH: the gate must decide before compilation is attempted,
    // and a passing document then stops at "No LaTeX engine found".
    env: { ...envWithoutPath(), CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', PATH: dirname(process.execPath) },
  });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* asserted by the caller */ }
  return { ...result, report };
}

test('generate-latex blocks an unsupported claim and does not compile', (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'output', 'cv.tex'), tex('Google', String.raw`Reduced latency by 95\%.`));
  const result = runLatex(root, 'output/cv.tex', 'output/cv.pdf');
  assert.equal(result.status, 1);
  assert.equal(result.report?.factCheck?.verdict, 'block', result.stdout + result.stderr);
  assert.match(result.report.factCheck.reason, /95%/);
  assert.match(result.report.factCheck.reason, /organization=google/);
  assert.equal(result.report.compiled, false);
  assert.equal(result.report.compileError, undefined, 'compilation was attempted after the gate blocked');
  assert.match(result.stderr, /Fact check failed for cv\.tex/);
});

test('generate-latex lets a supported document through to compilation', (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'output', 'cv.tex'), tex('Acme Corp', String.raw`Reduced latency by 15\%.`));
  const result = runLatex(root, 'output/cv.tex', 'output/cv.pdf', '--compile-only');
  assert.equal(result.report?.factCheck?.verdict, 'pass', result.stdout + result.stderr);
  assert.match(result.report.compileError ?? '', /No LaTeX engine found/, 'the gate passed but compilation was never reached');
});

test('generate-latex --source counts the user\'s own .tex as evidence', (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'source.tex'), tex('Initech', 'Kept the lights on.'));
  writeFileSync(join(root, 'output', 'cv.tex'), tex('Initech', 'Led a team of 4 engineers.'));
  assert.equal(runLatex(root, 'output/cv.tex', '--compile-only').report?.factCheck?.verdict, 'block');
  for (const flag of [['--source', 'source.tex'], ['--source=source.tex']]) {
    const result = runLatex(root, 'output/cv.tex', '--compile-only', ...flag);
    assert.equal(result.report?.factCheck?.verdict, 'pass', `${flag.join(' ')}: ${result.stdout}${result.stderr}`);
  }
});

test('generate-latex names a --source file that does not exist', (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'output', 'cv.tex'), tex('Acme Corp', 'Led a team of 4 engineers.'));
  const result = runLatex(root, 'output/cv.tex', '--compile-only', '--source', 'no-such.tex');
  assert.equal(result.status, 1);
  assert.equal(result.report?.factCheck?.verdict, 'block', result.stdout + result.stderr);
  assert.match(result.report.factCheck.reason, /--source file not found: .*no-such\.tex/);
  assert.equal(result.report.compileError, undefined, 'compilation was attempted after a missing --source');
});

test('generate-latex --skip-fact-check and a missing cv.md skip the gate', (t) => {
  const root = workspace();
  const bare = workspace({ withCv: false });
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); });
  const inflated = tex('Google', 'Led a team of 40 engineers.');
  writeFileSync(join(root, 'output', 'cv.tex'), inflated);
  writeFileSync(join(bare, 'output', 'cv.tex'), inflated);

  const skipped = runLatex(root, 'output/cv.tex', '--skip-fact-check');
  assert.deepEqual(skipped.report?.factCheck, { verdict: 'skipped', reason: '--skip-fact-check' });

  const noCv = runLatex(bare, 'output/cv.tex');
  assert.equal(noCv.report?.factCheck?.verdict, 'skipped', noCv.stdout + noCv.stderr);
  assert.match(noCv.report.factCheck.reason, /no cv\.md/);
});
