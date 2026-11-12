// tests/cv-latex-award-spacing.test.mjs — the two structural regressions behind
// the awards-section spacing bug found on report 204.
//
// Awards are one line each and carry no bullets, which broke two assumptions the
// rest of the template is built on:
//
//   1. buildAwards() joined its blocks with '\n\n'. Inside an itemize a blank
//      line starts a new paragraph, so parskip landed between two awards and the
//      gap measured 25.1pt where every other section uses 6.6-8.2pt.
//   2. The section reused \resumeProjectHeading, whose tail is \vspace{-7pt} to
//      pull the following bullet tight under a project title. An award has no
//      bullets, so that tail pulled the NEXT section title into the award line:
//      Kiez Connect and "Education" overlapped by 1pt, and the -7pt was also
//      cancelling the list's itemsep/parsep, so removing the tail alone opened a
//      22.6pt gap instead.
//
// The fix is structural (dedicated \resumeAward* commands plus a tight list), so
// the assertions here are structural too: this file runs no TeX engine. What it
// pins is the part a future edit can silently break — that awards stay on their
// own command pair, that the list is tight, and that the builder emits one
// newline between awards. Spacing itself is verified by compiling.
//
// End-to-end through the real builder and the shipped templates, because
// build-cv-latex.mjs exports nothing.
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nbuild-cv-latex — awards spacing structure (report 204)');

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  name: 'Award Spacing',
  contact_line: 'Berlin, Germany',
  summary: 'Summary.',
  experience: [{
    company: 'Corp',
    role: 'Engineer',
    location: 'Remote',
    dates: '2024 - Present',
    bullets: ['Shipped things.'],
  }],
  projects: [{
    name: 'Proj',
    context: 'Python',
    dates: '2024',
    bullets: ['Built it.'],
  }],
  awards: [
    { title: 'First Award', org: 'Org A', year: '2025' },
    { title: 'Second Award', org: 'Org B', year: '2024' },
    { title: 'Third Award', year: '2023' },
  ],
  education: [{
    institution: 'Uni',
    degree: 'BSc',
    dates: '2019',
  }],
  skills: [{ category: 'Core', items: 'Python' }],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-latex-awards-'));
try {
  const input = join(dir, 'awards.json');
  const output = join(dir, 'awards.tex');
  writeFileSync(input, JSON.stringify(PAYLOAD));

  const status = run(NODE, [join(ROOT, 'build-cv-latex.mjs'), input, output]);
  if (status === null || !existsSync(output)) {
    const f = lastRunFailure();
    fail(`build-cv-latex.mjs produced no .tex (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else {
    const tex = readFileSync(output, 'utf-8');

    // The section body, so a match cannot come from an unrelated section.
    const start = tex.indexOf('AWARDS  %');
    const end = tex.indexOf('EDUCATION  %', start);
    const awards = start === -1 ? '' : tex.slice(start, end === -1 ? undefined : end);

    start === -1
      ? fail('the .tex carries no AWARDS section banner to inspect')
      : pass('the .tex carries an AWARDS section');

    // Regression 1: no blank line between two awards. A '\n\n' inside an
    // itemize is a paragraph break, which is what widened the gap to 25.1pt.
    awards.includes('}\n\n') || awards.includes('\n\n    \\resumeAwardHeading')
      ? fail('awards are separated by a blank line — that is a paragraph break inside the list and re-opens the wide gap')
      : pass('awards are separated by a single newline, not a paragraph break');

    // Regression 2: the dedicated command, not the project heading whose
    // -7pt tail has nothing to pull tight.
    awards.includes('\\resumeProjectHeading')
      ? fail('awards still render through \\resumeProjectHeading — its -7pt tail drags the next section title into the last award line')
      : pass('awards do not reuse \\resumeProjectHeading');

    const headingCount = (awards.match(/\\resumeAwardHeading/g) || []).length;
    headingCount === PAYLOAD.awards.length
      ? pass(`all ${headingCount} awards render through \\resumeAwardHeading`)
      : fail(`expected ${PAYLOAD.awards.length} \\resumeAwardHeading, found ${headingCount}`);

    // The list wrapper is the template's job now, so the builder must not add
    // one of its own — two nested itemizes is a second set of list spacing.
    awards.includes('\\begin{itemize}')
      ? fail('the builder emitted its own itemize for awards; the template owns the award list')
      : pass('the builder does not open its own itemize for awards');

    // An award with no org must not leave a dangling "$|$" separator.
    /\\emph\{\$\|\$\s*\}/.test(awards) || awards.includes('$|$ }')
      ? fail('an award without an org renders a dangling "$|$" separator')
      : pass('an award without an org renders no separator');
  }

  // The template contract: both shipped templates must define the pair, and the
  // award list must be tight (a default itemize adds itemsep/parsep between two
  // one-line rows) with no negative tail dragging the following section in.
  for (const name of ['cv-template.tex', 'cv-template.cjk.tex']) {
    const path = join(ROOT, 'templates', name);
    if (!existsSync(path)) {
      fail(`templates/${name} is missing`);
      continue;
    }
    const tpl = readFileSync(path, 'utf-8');

    for (const cmd of ['resumeAwardHeading', 'resumeAwardListStart', 'resumeAwardListEnd']) {
      tpl.includes(`\\newcommand{\\${cmd}}`)
        ? pass(`${name} defines \\${cmd}`)
        : fail(`${name} does not define \\${cmd} — generate-latex.mjs requires it`);
    }

    const listStart = tpl.match(/\\newcommand\{\\resumeAwardListStart\}\{([^\n]*)\}/);
    const listLine = listStart ? listStart[1] : '';
    ['itemsep=1pt', 'parsep=0pt', 'topsep=0pt', 'partopsep=0pt'].every((k) => listLine.includes(k))
      ? pass(`${name}: the award list is tight (no default itemsep/parsep/topsep)`)
      : fail(`${name}: the award list left a default itemsep/parsep/topsep — two one-line awards will open a paragraph-sized gap`);

    const listEnd = tpl.match(/\\newcommand\{\\resumeAwardListEnd\}\{([^\n]*)\}/);
    const endLine = listEnd ? listEnd[1] : '';
    /\\vspace\{-[0-9.]+pt\}/.test(endLine)
      ? fail(`${name}: \\resumeAwardListEnd has a negative vspace — it will pull the next section title into the last award`)
      : pass(`${name}: \\resumeAwardListEnd carries no negative tail`);

    // The section must use the award list, not the shared subheading list —
    // that is the change that fixed the overlap with Education.
    const section = tpl.slice(tpl.indexOf('\\section{Awards \\& Honors}'));
    const sectionBody = section.slice(0, section.indexOf('\\section{', 10) === -1 ? undefined : section.indexOf('\\section{', 10));
    /\\resumeAwardListStart/.test(sectionBody) && !/\\resumeSubHeadingListStart/.test(sectionBody)
      ? pass(`${name}: the Awards section uses the award list`)
      : fail(`${name}: the Awards section does not use \\resumeAwardListStart (or still uses the shared subheading list)`);

    // Heading rows must wrap. An `l` column cannot break a line, so a project
    // name plus its tech list pushed the row past the right margin and off the
    // page, with the build still reporting valid:true. Same failure for the
    // project and award headings, since both put free text in the left cell.
    for (const cmd of ['resumeProjectHeading', 'resumeAwardHeading']) {
      const macro = tpl.match(new RegExp(`\\\\newcommand\\{\\\\${cmd}\\}\\[2\\]\\{([\\s\\S]*?)\\n\\}`));
      const body = macro ? macro[1] : '';
      // Both cells must wrap: the left holds the name and its tech list, the
      // right holds a date or a descriptor, and either can be too long. An `l`
      // or `r` column cannot break at all, so that cell runs off the page.
      const paragraphCols = (body.match(/p\{[0-9.]+\\textwidth\}/g) || []).length;
      !body
        ? fail(`${name}: could not read \\${cmd} to check its columns`)
        : paragraphCols === 2 && !/[\{@](l|r)@\{/.test(body)
          ? pass(`${name}: \\${cmd} uses two wrapping paragraph columns`)
          : fail(`${name}: \\${cmd} has ${paragraphCols} wrapping column(s) of 2 — an over-long heading cell runs off the page edge`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}