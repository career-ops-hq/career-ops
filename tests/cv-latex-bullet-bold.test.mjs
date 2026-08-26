// tests/cv-latex-bullet-bold.test.mjs — the LaTeX mirror of #1728 (#3351).
//
// #1728 taught the HTML path to render `**text**` as <strong>, in
// normalizeTextForATS (generate-pdf.mjs). The conversion walks every text node,
// so it already covered experience and project bullets, and cv-template.html
// ships `.job li strong` to style them. build-cv-latex.mjs had no equivalent:
// escapeLatex() leaves `*` alone because it is not a LaTeX special character,
// so the markers reached the .tex verbatim and printed as literal asterisks —
// the same payload emphasised in the HTML PDF and showed `**1018 KB**` in the
// LaTeX one, with the builder reporting "valid": true and exiting 0.
//
// End-to-end through the real builder and the shipped template, because
// build-cv-latex.mjs exports nothing.
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbuild-cv-latex — markdown bold in bullets (#3351)');

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Bold Bullets', email: 'bold@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{
    company: 'Corp',
    role: 'Engineer',
    location: 'Remote',
    dates: '2024 - Present',
    bullets: [
      // Bold applied, and LaTeX specials inside the span still escaped.
      'Cut cold start to **1018 KB** on a **$2M budget & 99.9% uptime**',
      // Injection probe: a literal \textbf typed by the candidate must stay
      // inert text rather than becoming a control sequence.
      'Wrote \\textbf{this} by hand and left 5 * 3 and *single* asterisks alone',
      // An unmatched marker has no closing pair, so it stays literal.
      'Unmatched **marker stays literal',
      // A bold span cannot contain a `*`, so this one matches nothing. Pinned
      // because it fails silently — the builder still exits 0 with valid:true.
      'Nested **a *b* c** markers',
    ],
  }],
  projects: [{
    name: 'Proj',
    dates: '2024',
    bullets: ['Built a REST API with **test coverage exceeding 90%**'],
  }],
  // Coursework carries no `bullets` key but renders inside a \resumeItem, so it
  // goes through the same gate — the output shape decides, not the field name.
  education: [{
    institution: 'Uni',
    degree: 'BSc',
    dates: '2019',
    coursework: ['**Distributed Systems**', 'Algorithms'],
  }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-latex-bold-'));
try {
  const input = join(dir, 'bold.json');
  const output = join(dir, 'bold.tex');
  writeFileSync(input, JSON.stringify(PAYLOAD));

  if (run(NODE, [join(ROOT, 'build-cv-latex.mjs'), input, output]) === null) {
    const f = lastRunFailure();
    fail(`build-cv-latex.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else if (!existsSync(output)) {
    fail('build-cv-latex.mjs exited 0 but wrote no output file');
  } else {
    const tex = readFileSync(output, 'utf-8');

    // The bug, asserted directly: the markers must not reach the .tex.
    tex.includes('**1018 KB**')
      ? fail('markdown bold reached the .tex as literal asterisks (**1018 KB**)')
      : pass('the bold markers do not survive into the .tex as literal asterisks');

    const checks = [
      ['experience bullets render bold as \\textbf', '\\textbf{1018 KB}'],
      ['project bullets render bold as \\textbf', '\\textbf{test coverage exceeding 90\\%}'],
      // Coursework is emitted inside a \resumeItem, so it is a bullet in the
      // output even though the payload key is not `bullets`.
      ['coursework renders bold as \\textbf', '\\textbf{Distributed Systems}'],
      // Escaping runs FIRST, so a bold span keeps its \$ \& \% intact.
      ['LaTeX specials inside a bold span stay escaped', '\\textbf{\\$2M budget \\& 99.9\\% uptime}'],
      // ...and nothing the candidate typed can become a real control sequence.
      ['a literal \\textbf in payload text stays inert', '\\textbackslash{}textbf\\{this\\}'],
      // Single asterisks are not emphasis.
      ['single asterisks are left alone', '5 * 3 and *single* asterisks'],
      // An odd marker is not emphasis either.
      ['an unmatched ** marker stays literal', 'Unmatched **marker stays literal'],
      // Known limit, pinned rather than fixed: a `*` inside the span breaks the
      // match, and the markers ship literally with no error. Same regex as the
      // HTML twin, so changing it here alone would re-open the divergence.
      ['a bold span containing * matches nothing', 'Nested **a *b* c** markers'],
    ];

    for (const [what, needle] of checks) {
      tex.includes(needle)
        ? pass(what)
        : fail(`${what} — expected to find ${JSON.stringify(needle)} in the .tex`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
