// tests/latex-escape.test.mjs — escapeLatex/sanitizeUrl regressions.
//
// 1. OT1 glyph substitution: pdflatex's default text encoding has no glyph for
//    <, >, or | — they silently print as ¡, ¿, and an em-dash, so a bullet like
//    "Cut p99 latency to <100ms" rendered "¡100ms" in every compiled CV. The
//    escaper must emit the \textless/\textgreater/\textbar commands instead.
// 2. mailto duplication: sanitizeUrl() prefixes bare addresses with mailto:,
//    and the template used to add its own mailto: on top, producing a broken
//    \href{mailto:mailto:...} link in every generated PDF. The contract is that
//    sanitizeUrl's output already carries its scheme.
import { pass, fail, run, ROOT, NODE, formatRunFailure } from './helpers.mjs';
import { escapeLatex, sanitizeUrl } from '../lib/latex-escape.mjs';

console.log('\nlatex-escape — OT1-unsafe glyphs and mailto scheme handling');

const escaped = escapeLatex('Cut p99 latency to <100ms, >2x throughput on the a|b split');
escaped.includes('\\textless{}100ms') && escaped.includes('\\textgreater{}2x') && escaped.includes('a\\textbar{}b')
  ? pass('escapeLatex converts < > | to their text commands')
  : fail(`escapeLatex left OT1-unsafe glyphs raw: ${escaped}`);

!/[<>|]/.test(escaped)
  ? pass('no raw < > | survive escaping')
  : fail(`raw OT1-unsafe glyph survived: ${escaped}`);

sanitizeUrl('test@example.com') === 'mailto:test@example.com'
  ? pass('sanitizeUrl prefixes a bare address with mailto:')
  : fail(`sanitizeUrl bare-address handling changed: ${sanitizeUrl('test@example.com')}`);

sanitizeUrl('mailto:test@example.com') === 'mailto:test@example.com'
  ? pass('sanitizeUrl keeps an explicit mailto: single')
  : fail(`sanitizeUrl doubled an explicit mailto: ${sanitizeUrl('mailto:test@example.com')}`);

// Template contract: cv-template.tex must not prepend its own mailto: —
// sanitizeUrl's output already carries the scheme.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const tex = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'cv-template.tex'), 'utf-8');
!tex.includes('\\href{mailto:{{EMAIL_URL}}}')
  ? pass('cv-template.tex does not double the mailto: scheme')
  : fail('cv-template.tex still wraps {{EMAIL_URL}} in a second mailto:');

// ---------------------------------------------------------------------------
// End-to-end rendering contract.
//
// The source-level check above only proves the template string no longer holds
// a literal doubled scheme. It cannot catch the two ways the *rendered* .tex can
// still come out wrong:
//
//   1. Scheme doubling reintroduced anywhere else on the path — a second
//      sanitizeUrl() pass, a normalizer in build-cv-latex.mjs, or a template
//      variant — would produce \href{mailto:mailto:...}, a dead link in every
//      generated PDF, while the template source stayed clean.
//   2. Brace arithmetic. The template line is `\href{{{EMAIL_URL}}}{...}`:
//      three opening braces = the outer \href argument brace plus the two
//      {{...}} placeholder delimiters. The substitution regex /\{\{KEY\}\}/g
//      matches at offset 1, leaving the outermost brace pair for LaTeX. Change
//      the placeholder syntax or the regex and the match can slide to offset 0,
//      eating the \href argument brace and emitting `\href mailto:...}}` —
//      which does not compile at all. Only the rendered bytes show this.
//
// So render through the real CLI (no reimplementation of the substitution here;
// a test that re-derives the output cannot detect a renderer regression) and
// assert on the exact \href value.
const CV_JSON = {
  name: 'Test Candidate',
  contact_line: 'City, State',
  linkedin: { url: 'https://linkedin.com/in/test', display: 'linkedin.com/in/test' },
  github: { url: 'https://github.com/test', display: 'github.com/test' },
  education: [],
  experience: [{ company: 'Test Corp', role: 'Test Engineer', location: 'Remote', dates: '2024', bullets: ['Did a thing'] }],
  projects: [],
  skills: [{ category: 'Languages', items: 'Python' }],
};

/**
 * Render the CV template through build-cv-latex.mjs with the given email URL
 * and return the produced .tex source (or null when the CLI failed).
 */
function renderWithEmail(emailUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'latex-href-'));
  try {
    const inPath = join(dir, 'cv.json');
    const outPath = join(dir, 'cv.tex');
    writeFileSync(inPath, JSON.stringify({ ...CV_JSON, email: { url: emailUrl, display: 'test@example.com' } }), 'utf-8');
    if (run(NODE, [join(ROOT, 'build-cv-latex.mjs'), inPath, outPath]) === null) return null;
    return readFileSync(outPath, 'utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXPECTED_HREF = '\\href{mailto:test@example.com}{';

for (const [label, input] of [['a bare address', 'test@example.com'], ['an explicit mailto: URL', 'mailto:test@example.com']]) {
  const rendered = renderWithEmail(input);
  if (rendered === null) {
    fail(`build-cv-latex.mjs failed to render ${label}${formatRunFailure()}`);
    continue;
  }

  // The exact rendered link, outer LaTeX brace included. Asserting the trailing
  // `{` of `\href{url}{text}` is what pins the brace balance: if substitution
  // consumed the \href argument brace, the closing `}` would land elsewhere and
  // this literal would not appear.
  rendered.includes(EXPECTED_HREF)
    ? pass(`rendered .tex has \\href{mailto:test@example.com}{ for ${label}`)
    : fail(`rendered \\href is wrong for ${label}: ${(rendered.match(/^.*\\href.*faEnvelope.*$/m) || ['<no email href line found>'])[0]}`);

  // Explicit negative: the exact bug this PR fixed. Kept separate from the
  // positive assertion so a regression names itself in the log.
  !rendered.includes('mailto:mailto:')
    ? pass(`rendered .tex has no doubled mailto: scheme for ${label}`)
    : fail(`rendered .tex doubled the mailto: scheme for ${label}`);

  // Same three-brace pattern, same regex — if the brace arithmetic breaks for
  // EMAIL_URL it breaks for these too, and a mailto-only test would miss it.
  rendered.includes('\\href{https://linkedin.com/in/test}{') && rendered.includes('\\href{https://github.com/test}{')
    ? pass(`rendered .tex keeps the outer \\href braces for LINKEDIN_URL/GITHUB_URL (${label} run)`)
    : fail(`LINKEDIN_URL/GITHUB_URL lost their outer \\href braces (${label} run)`);
}
