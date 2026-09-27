/**
 * cv-latex-contact.test.mjs — a LaTeX CV must carry a way to be contacted.
 *
 * The failure this exists for is silent, which is the whole problem. The
 * template writes the email as
 *
 *   \href{{{EMAIL_URL}}}{...\underline{{{EMAIL_DISPLAY}}}}
 *
 * and both placeholders substitute to the empty string when the payload omits
 * them. So the unresolved-placeholder check in validateLatexContent() never
 * fires, MIN_SECTIONS is satisfied, the file compiles, and the CV ships with an
 * envelope icon that links to nothing. Nothing in the pipeline objects. The
 * recruiter discovers it by not being able to reply.
 *
 * The trap underneath it is the payload contract. LaTeX wants
 *
 *   "email": { "url": "...", "display": "..." }
 *
 * while config/profile.yml and the HTML payload both use a flat string
 * (KNOWN_ROOT_KEYS in lib/cv-payload-schema.mjs keeps the two vocabularies
 * apart by design). A flat string is not rejected: `payload.email?.url` is
 * undefined, so it degrades to the same empty \href{} as an absent key. Two
 * unrelated mistakes, one indistinguishable outcome — hence a test per shape.
 *
 * Everything here is engine-free. Compiling needs tectonic or pdflatex, so the
 * one compile test skips when neither is installed rather than going quietly
 * green.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { validateLatexContent } from '../generate-latex.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE = process.execPath;

const EMAIL = { url: 'ada@example.com', display: 'ada@example.com' };
const LINKEDIN = { url: 'https://linkedin.com/in/ada', display: 'linkedin.com/in/ada' };
const GITHUB = { url: 'https://github.com/ada', display: 'github.com/ada' };

// Enough sections to clear MIN_SECTIONS, so a test failure means the contact
// block and not an under-populated CV.
const BASE = {
  name: 'Ada Lovelace',
  contact_line: 'London, UK | +44 20 7946 0000',
  education: [{ institution: 'Analytical Society', degree: 'BSc Mathematics', dates: '2018', coursework: ['Logic'] }],
  experience: [{ company: 'Analytical Engine Co', role: 'Engineer', dates: '2019', bullets: ['Wrote a program.'] }],
  projects: [{ name: 'Note G', context: 'Author', dates: '1843', bullets: ['Annotated the engine.'] }],
  awards: [{ title: 'Prize', year: '2020' }],
  skills: [{ category: 'Core', items: 'Programming' }],
};

function renderTex(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'cops-tex-contact-'));
  try {
    const input = join(dir, 'cv.json');
    const output = join(dir, 'cv.tex');
    writeFileSync(input, JSON.stringify(payload));
    execFileSync(NODE, ['build-cv-latex.mjs', input, output], { cwd: ROOT, encoding: 'utf-8' });
    return readFileSync(output, 'utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(tex) {
  return validateLatexContent(tex, false, 'tectonic');
}

function mailtoIssue(result) {
  return result.issues.find((i) => /Empty email link/.test(i));
}

test('a complete payload renders the email as a mailto href', () => {
  // The positive case, so the guard below cannot pass by flagging everything.
  const tex = renderTex({ ...BASE, email: EMAIL, linkedin: LINKEDIN, github: GITHUB });
  assert.match(tex, /\\href\{mailto:ada@example\.com\}/, 'no mailto: href in the .tex');
  assert.match(tex, /ada@example\.com/, 'email is not visible to the reader');
  assert.equal(mailtoIssue(check(tex)), undefined, 'a complete CV must validate clean');
});

test('a missing email is flagged instead of rendering a dead link', () => {
  const tex = renderTex({ ...BASE, linkedin: LINKEDIN, github: GITHUB });
  // The silent state, stated directly: the empty href is really in the output.
  assert.match(tex, /\\href\{\}/, 'expected the empty href this test is about');
  assert.ok(mailtoIssue(check(tex)), 'a CV with no email passed validation');
});

test('a flat-string email is flagged, not silently dropped', () => {
  // The shape config/profile.yml and the HTML payload use. `payload.email?.url`
  // on a string is undefined, so this degrades to the same empty \href{} as an
  // absent key — which is why the message names the object form.
  const result = check(renderTex({ ...BASE, email: 'ada@example.com' }));
  const issue = mailtoIssue(result);
  assert.ok(issue, 'a flat-string email passed validation');
  assert.match(issue, /url/, 'the issue should show the object form the builder wants');
});

test('an email object with an empty url is flagged', () => {
  const result = check(renderTex({ ...BASE, email: { url: '', display: '' } }));
  assert.ok(mailtoIssue(result), 'an empty email url passed validation');
});

test('an absent optional link is a count, not an issue', () => {
  // EMAIL/LINKEDIN/GITHUB are three unconditional \href{}s, so a candidate with
  // no GitHub renders two live links and one dead one. That is cosmetic and
  // must not fail the build — but it stays visible in the counts, so "0 contact
  // links" is a number a reader can see rather than something to spot in a PDF.
  const result = check(renderTex({ ...BASE, email: EMAIL, linkedin: LINKEDIN }));
  assert.equal(mailtoIssue(result), undefined, 'a missing GitHub must not be an error');
  assert.equal(result.counts.emptyContactLinks, 1, 'the dead link should still be counted');
  assert.equal(result.counts.contactLinks, 3, 'all three template slots are always emitted');
});

test('compileOnly ignores the contact block entirely', () => {
  // latex-tex mode compiles a hand-tuned .tex that has no placeholders at all.
  // The new check sits after the compileOnly early return precisely so it
  // cannot start failing those CVs; this pins that ordering, because moving the
  // check above the return is a one-line mistake that breaks the mode silently
  // for everyone who maintains their own .tex.
  const bare = '\\documentclass{article}\\begin{document}No contact block here.\\end{document}';
  const result = validateLatexContent(bare, true, 'tectonic');
  assert.deepEqual(result.issues, [], 'compileOnly must not inspect the contact block');
  assert.ok(!('contactLinks' in result.counts), 'compileOnly returns before the contact counts too');
});

test('compiles to a non-empty PDF when a LaTeX engine is installed', () => {
  // The one test that needs a toolchain. Skips loudly rather than passing on
  // absence — a skipped compile is honest, a silently-green one is not.
  const engine = ['tectonic', 'pdflatex'].find((bin) => {
    try {
      execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  if (!engine) {
    test.skip('no tectonic or pdflatex on PATH — compile check skipped');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'cops-tex-compile-'));
  try {
    const input = join(dir, 'cv.json');
    const tex = join(dir, 'cv.tex');
    const pdf = join(dir, 'cv.pdf');
    writeFileSync(input, JSON.stringify({ ...BASE, email: EMAIL, linkedin: LINKEDIN, github: GITHUB }));
    execFileSync(NODE, ['build-cv-latex.mjs', input, tex], { cwd: ROOT, encoding: 'utf-8' });
    const result = check(readFileSync(tex, 'utf-8'));
    assert.equal(mailtoIssue(result), undefined, 'the CV to compile has no email');
    execFileSync(NODE, ['generate-latex.mjs', tex, pdf, '--compile-only'], { cwd: ROOT, encoding: 'utf-8' });
    assert.ok(existsSync(pdf), `${engine} produced no PDF`);
    assert.ok(readFileSync(pdf).length > 1000, 'the PDF is implausibly small');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
