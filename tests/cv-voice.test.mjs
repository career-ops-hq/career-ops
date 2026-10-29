import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateOwnWords, voiceDashWarning, voiceIssues, voiceTellMessage } from '../cv-voice.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SOURCE = `# Jane Doe

jane@example.com

## Experience

### Program Manager, Northwind Payments
2021 - 2024

- Ran the weekly release train for the payments app
- Cut deploy time from 2 weeks to 4 hours by writing a checklist the engineers follow
- Worked with support to rewrite the refund help page
`;

const WITH_OWN_VERB = `${SOURCE}- Spearheaded the on-call rota the team already had\n`;

test('a line the candidate wrote is kept, stock verb included', () => {
  const copied = 'Spearheaded the on-call rota the team already had';
  assert.deepEqual(voiceIssues(copied, WITH_OWN_VERB).filter((issue) => issue.kind !== 'invented-number'), []);
  const reused = voiceIssues('Spearheaded the refund help page with support', WITH_OWN_VERB);
  assert.equal(reused.some((issue) => issue.value === 'spearheaded'), false);
});

test('a generated line that adds spearheaded, leveraged, or an em dash fails', () => {
  const generated = [
    'Results-driven program manager who spearheaded cross-functional launches \u2014 leveraging SQL \u2014 to drive significant impact.',
    'Ran the weekly release train for the payments app',
  ].join('\n');
  const issues = voiceIssues(generated, SOURCE);
  const values = issues.map((issue) => issue.value);
  assert.ok(values.includes('spearheaded'));
  assert.ok(values.includes('leveraging'));
  assert.ok(values.includes('results-driven'));
  assert.ok(values.includes('significant impact'));
  assert.ok(values.includes('em dash'));
  assert.match(voiceTellMessage(issues, 'cv.html'), /Voice check failed for cv\.html/);
  assert.match(voiceTellMessage(issues, 'cv.html'), /Keep the candidate's own words/);
  assert.equal(/em dash/.test(voiceTellMessage(issues, 'cv.html')), false);
  assert.match(voiceDashWarning(issues, 'cv.html'), /Voice check warning for cv\.html/);
  assert.match(voiceDashWarning(issues, 'cv.html'), /an em dash/);
});

test('an en dash in a new line warns and a copied en dash does not', () => {
  const source = 'Northwind Payments \u2013 2021 to 2024';
  assert.deepEqual(voiceIssues(source, source).filter((issue) => issue.kind === 'em-dash'), []);
  const fresh = voiceIssues('Owned the payments calendar \u2013 the one the team prints', source);
  assert.deepEqual(fresh.filter((issue) => issue.kind === 'em-dash').map((issue) => issue.value), ['en dash']);
  assert.equal(voiceTellMessage(fresh), null);
  assert.match(voiceDashWarning(fresh), /an en dash/);
});

test('a short line copied whole from the CV keeps its dash', () => {
  const source = 'Program Manager\n2021\u20132024\n';
  assert.deepEqual(voiceIssues('2021\u20132024', source).filter((issue) => issue.kind === 'em-dash'), []);
});

test('a date range dash and the page title are not stock wording', () => {
  const html = [
    '<html><head><title>Jane Doe \u2014 CV</title></head><body>',
    '<p>Northwind Payments</p><p>2022\u20132024</p><p>Mar 2020 \u2013 Present</p>',
    '<p>Ran the weekly release train for the payments app</p>',
    '</body></html>',
  ].join('\n');
  assert.deepEqual(voiceIssues(html, SOURCE).filter((issue) => issue.kind === 'em-dash'), []);
  const prose = voiceIssues('<p>Shipped in 2024 \u2013 on time</p>', SOURCE);
  assert.deepEqual(prose.filter((issue) => issue.kind === 'em-dash').map((issue) => issue.value), ['en dash']);
});

test('a metric range written with a dash warns and does not fail the check', () => {
  const source = 'Improved conversion by 20 to 30% on the refund page';
  const generated = 'Improved conversion by 20\u201330% on the refund page';
  const issues = voiceIssues(generated, source);
  assert.deepEqual(issues.filter((issue) => issue.kind === 'em-dash').map((issue) => issue.value), ['en dash']);
  assert.equal(voiceTellMessage(issues), null);
  assert.match(voiceDashWarning(issues), /an en dash/);
});

test('a number that is not in the source fails, and one that is does not', () => {
  const invented = voiceIssues('Cut deploy time by 40% with the same checklist', SOURCE);
  assert.ok(invented.some((issue) => issue.kind === 'invented-number' && issue.value === '40%'));
  assert.equal(voiceTellMessage(invented), null);
  const kept = voiceIssues('Cut deploy time from 2 weeks to 4 hours by writing a checklist the engineers follow', SOURCE);
  assert.deepEqual(kept, []);
});

test('leverage does not match inside a longer word the candidate used', () => {
  const source = 'Wrote the unleveraged cash report';
  assert.deepEqual(voiceIssues('Wrote the unleveraged cash report', source), []);
});

test('generate-latex blocks a stock verb and still blocks an invented metric', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-latex-'));
  try {
    mkdirSync(join(root, 'output'));
    writeFileSync(join(root, 'cv.md'), SOURCE);
    const tex = (bullet) => `\\documentclass{article}\n\\begin{document}\n\\resumeItem{${bullet}}\n\\end{document}\n`;
    writeFileSync(join(root, 'output', 'stock.tex'), tex('Spearheaded the weekly release train for the payments app'));
    const stock = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/stock.tex', '--compile-only'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const stockReport = JSON.parse(stock.stdout);
    assert.equal(stockReport.factCheck.verdict, 'block');
    assert.match(stockReport.factCheck.reason, /spearheaded/);
    assert.equal(stockReport.compiled, false);

    writeFileSync(join(root, 'output', 'number.tex'), tex('Cut deploy time by 40\\% with the same checklist'));
    const number = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/number.tex', '--compile-only'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const numberReport = JSON.parse(number.stdout);
    assert.equal(numberReport.factCheck.verdict, 'block');
    assert.match(numberReport.factCheck.reason, /40%/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dash the candidate wrote still counts when --source is a separate tex file', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-source-tex-'));
  try {
    mkdirSync(join(root, 'output'));
    mkdirSync(join(root, 'sources'));
    const line = 'Ran the weekly release train \u2014 the Tuesday one';
    writeFileSync(join(root, 'cv.md'), `${SOURCE}\n- ${line}\n`);
    writeFileSync(join(root, 'sources', 'own.tex'), '\\documentclass{article}\n\\begin{document}\nKept my own notes.\n\\end{document}\n');
    writeFileSync(join(root, 'output', 'copied.tex'), `\\documentclass{article}\n\\begin{document}\n\\resumeItem{${line}}\n\\end{document}\n`);
    const run = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/copied.tex', '--compile-only', '--source', 'sources/own.tex'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const report = JSON.parse(run.stdout);
    const reason = report.factCheck.reason || '';
    assert.equal(/dash/.test(reason), false, reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a word in the cv-facts allow list or in voice-dna outside the banned list is kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-own-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({
      allow_metrics: [],
      allow_facts: ['spearheaded the on-call rota'],
      forbidden_phrases: ['leveraged'],
      warn_phrases: [],
    }));
    writeFileSync(join(root, 'voice-dna.md'), [
      '# Voice',
      'I write leveraged when I mean the loan book at Northwind.',
      '## 3. BANNED LIST',
      'spearheaded, leveraged, delve',
      '## 4. After',
      'Short sentences.',
    ].join('\n'));
    const own = candidateOwnWords(root);
    const spear = voiceIssues('She spearheaded the on-call rota for Northwind', `${SOURCE}\n${own}`);
    assert.equal(spear.some((issue) => issue.value === 'spearheaded'), false);
    const loan = voiceIssues('She leveraged the loan book at Northwind', `${SOURCE}\n${own}`);
    assert.equal(loan.some((issue) => issue.value === 'leveraged'), false);
    writeFileSync(join(root, 'voice-dna.md'), '# Voice\n## Banned list\nspearheaded\n');
    writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({
      allow_metrics: [],
      allow_facts: [],
      forbidden_phrases: ['spearheaded'],
      warn_phrases: [],
    }));
    const bannedOnly = voiceIssues('She spearheaded the weekly release train', `${SOURCE}\n${candidateOwnWords(root)}`);
    assert.ok(bannedOnly.some((issue) => issue.value === 'spearheaded'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generate-latex warns on a long dash and does not block the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-dash-'));
  try {
    mkdirSync(join(root, 'output'));
    writeFileSync(join(root, 'cv.md'), SOURCE);
    writeFileSync(join(root, 'output', 'dash.tex'), `\\documentclass{article}\n\\begin{document}\nRan the weekly release train \u2013 the Tuesday one\n\\end{document}\n`);
    const run = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/dash.tex', '--compile-only'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const report = JSON.parse(run.stdout);
    assert.equal(report.factCheck.verdict, 'warn');
    assert.match(report.factCheck.reason, /en dash/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generate-latex allows a stock verb the candidate listed in cv-facts', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-allow-'));
  try {
    mkdirSync(join(root, 'output'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'cv.md'), SOURCE);
    writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({
      allow_metrics: [],
      allow_facts: ['spearheaded'],
      forbidden_phrases: [],
      warn_phrases: [],
    }));
    writeFileSync(join(root, 'output', 'own.tex'), '\\documentclass{article}\n\\begin{document}\n\\resumeItem{Spearheaded the weekly release train for the payments app}\n\\end{document}\n');
    const run = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/own.tex', '--compile-only'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const report = JSON.parse(run.stdout);
    const reason = report.factCheck.reason || '';
    assert.equal(/spearheaded/.test(reason), false, reason);
    assert.notEqual(report.factCheck.verdict, 'block');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generate-latex checks wording against cv.md, not article-digest.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-voice-digest-'));
  try {
    mkdirSync(join(root, 'output'));
    writeFileSync(join(root, 'cv.md'), SOURCE);
    writeFileSync(join(root, 'article-digest.md'), '# Notes\n\n- Spearheaded the weekly release train for the payments app\n');
    writeFileSync(join(root, 'output', 'digest.tex'), '\\documentclass{article}\n\\begin{document}\n\\resumeItem{Spearheaded the weekly release train for the payments app}\n\\end{document}\n');
    const run = spawnSync(process.execPath, [join(ROOT, 'generate-latex.mjs'), 'output/digest.tex', '--compile-only'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    const report = JSON.parse(run.stdout);
    assert.equal(report.factCheck.verdict, 'block');
    assert.match(report.factCheck.reason, /spearheaded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
