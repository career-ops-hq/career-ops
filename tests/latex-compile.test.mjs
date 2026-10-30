// tests/latex-compile.test.mjs — both shipped LaTeX CV templates compile (#5756).
//
// Every other LaTeX test checks strings: what escapeLatex() emits, what
// validateLatexContent() reports. None runs a TeX engine, so a template edit or
// an escaping change that stops compilation passed them all. Two did, and were
// found by users: a raw `&` in a project link stopped pdflatex (#4288), and
// `< > |` printed as other glyphs (#2378).
//
// This builds a payload carrying those characters through build-cv-latex.mjs
// into templates/cv-template.tex and templates/cv-template.cjk.tex, compiles
// each with generate-latex.mjs, and reads the PDF's text back with pdftotext.
//
// Needs a TeX engine (`node install-latex-engine.mjs`), and tectonic plus a
// "Noto Serif CJK SC" font for the CJK template. Where those are missing the
// checks are skipped with a warning; under `test-all.mjs --needs latex`, which
// the tool-suites CI job runs with tectonic installed, a missing one fails.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, toolUnavailable, ROOT, NODE, rmSync } from './helpers.mjs';
import { resolveLatexEngine } from '../generate-latex.mjs';

console.log('\nLaTeX CV templates compile, with the characters that broke them before (#5756)');

// tectonic fetches its TeX bundle on a first compile; that is most of the time.
const COMPILE_TIMEOUT_MS = 5 * 60_000;

const payload = (cjk) => ({
  name: cjk ? '张伟 Wei Zhang' : 'Wei Zhang',
  contact_line: 'Toronto, ON | +1 416 555 0100',
  email: { url: 'wei@example.com', display: 'wei@example.com' },
  linkedin: { url: 'https://www.linkedin.com/in/test%C3%A9-user', display: 'linkedin.com/in/wei' },
  github: { url: 'https://github.com/wei/proj#readme', display: 'github.com/wei' },
  education: [{
    institution: 'University of Toronto',
    location: 'Toronto, ON',
    degree: 'BSc Computer Science',
    dates: '2014 - 2018',
    coursework: ['Algorithms & Data Structures', '**Compilers**'],
  }],
  experience: [{
    company: 'Query & Co',
    role: 'Staff Engineer',
    location: 'Remote',
    dates: '2019 - Present',
    bullets: [
      'Cut p99 latency by 40% for 3 teams; C# and F# services, snake_case APIs',
      'Owned a $5M budget across ~12 engineers',
      'Reviewed rules where a < b > c | d held',
      'Shipped the **ledger rewrite** ahead of plan',
      ...(cjk ? ['负责支付系统的架构设计'] : []),
    ],
  }],
  projects: [{
    name: 'Ledger Tools',
    context: 'Go, Postgres',
    dates: '2023',
    url: 'https://www.youtube.com/watch?v=abc&t=10s',
    bullets: ['Built tools at ~/bin with 100% coverage'],
  }],
  awards: [{ title: 'Hackathon & Prize', org: 'ACME', year: '2022' }],
  skills: [{ category: 'Languages', items: 'C#, C++, Go, SQL' }],
});

// Text that must come through the PDF's text layer. Spacing varies with the
// engine and the extractor, so whitespace is collapsed on both sides.
const EXPECTED = (cjk) => [
  'Query & Co',
  'by 40% for 3 teams',
  'C# and F# services, snake_case APIs',
  'a $5M budget across ~12 engineers',
  'a < b > c | d held',
  'the ledger rewrite ahead',
  'at ~/bin with 100% coverage',
  'Algorithms & Data Structures',
  'Hackathon & Prize',
  ...(cjk ? ['张伟', '负责支付系统的架构设计'] : []),
];

const squash = (s) => s.replace(/\s+/g, ' ').trim();

const engine = resolveLatexEngine();
const hasPdftotext = spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).status === 0;

if (!engine) {
  toolUnavailable('latex', 'LaTeX compile checks skipped: no tectonic or pdflatex (`node install-latex-engine.mjs` installs tectonic)');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'latex-compile-'));
  try {
    for (const variant of ['standard', 'cjk']) {
      const cjk = variant === 'cjk';
      const label = `${variant} template (${engine})`;
      if (cjk && engine !== 'tectonic') {
        toolUnavailable('latex', `CJK template compile skipped: it needs tectonic, and this machine resolves ${engine}`);
        continue;
      }

      const input = join(dir, `${variant}.json`);
      const tex = join(dir, `${variant}.tex`);
      const pdf = join(dir, `${variant}.pdf`);
      writeFileSync(input, JSON.stringify(payload(cjk)));

      const build = spawnSync(NODE, [join(ROOT, 'build-cv-latex.mjs'), input, tex, ...(cjk ? ['--template=cjk'] : [])], {
        cwd: ROOT, encoding: 'utf-8', timeout: 60_000,
      });
      if (build.status !== 0 || !existsSync(tex)) {
        fail(`${label}: build-cv-latex.mjs exited ${build.status} — ${(build.stderr || build.stdout).trim().split('\n').slice(-3).join(' / ')}`);
        continue;
      }

      const compile = spawnSync(NODE, [join(ROOT, 'generate-latex.mjs'), tex, pdf, '--skip-fact-check'], {
        cwd: ROOT, encoding: 'utf-8', timeout: COMPILE_TIMEOUT_MS,
      });
      let report = null;
      try { report = JSON.parse(compile.stdout); } catch { /* reported below */ }
      if (compile.status !== 0 || !report?.compiled) {
        const why = report?.compileError || report?.issues?.join('; ') || compile.error?.message || compile.stderr || compile.stdout;
        // A missing CJK font is this machine's gap, not the template's; any
        // other compile error is the template's.
        if (cjk && /The font "Noto Serif CJK SC" cannot be found/.test(String(why))) {
          toolUnavailable('latex', `${label}: the "Noto Serif CJK SC" font is not installed — ${squash(String(why)).slice(0, 200)}`);
        } else {
          // tectonic's message leads with the command line; its `error:` lines
          // (pdflatex's `!` lines) are the part worth reading.
          const errors = String(why).split('\n').map((l) => l.trim()).filter((l) => /^(error:|!)/.test(l));
          fail(`${label} does not compile (exit ${compile.status}): ${errors.slice(0, 4).join(' / ') || squash(String(why)).slice(0, 600)}`);
        }
        continue;
      }
      const bytes = existsSync(pdf) ? readFileSync(pdf) : null;
      if (bytes && bytes.length > 1024 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
        pass(`${label} compiles to a ${(bytes.length / 1024).toFixed(0)} KB PDF`);
      } else {
        fail(`${label}: generate-latex.mjs reported success but ${pdf} is ${bytes ? `${bytes.length} bytes, not a PDF` : 'missing'}`);
        continue;
      }

      // Compiles but renders the wrong glyphs is the #2378 shape: only the
      // text layer shows it.
      if (!hasPdftotext) {
        toolUnavailable('latex', `${label}: text-layer check skipped, pdftotext (Poppler) is not installed`);
        continue;
      }
      const text = squash(spawnSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf-8' }).stdout || '');
      const missing = EXPECTED(cjk).filter((s) => !text.includes(squash(s)));
      if (missing.length === 0) pass(`${label}: the PDF text layer carries & % # ~ _ $ < > | and bold as written`);
      else fail(`${label}: the PDF text layer is missing ${missing.map((s) => JSON.stringify(s)).join(', ')} — got: ${text.slice(0, 600)}`);
      if (text.includes('**')) fail(`${label}: markdown bold reached the PDF as literal asterisks`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
