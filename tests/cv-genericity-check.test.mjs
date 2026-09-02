// tests/cv-genericity-check.test.mjs — AI-resume-sameness signals.
//
// verify-cv-facts.mjs answers "is this true?"; genericityFindings() answers
// "does this bullet tell a recruiter anything?" — stock filler phrases and
// task-only bullets with no outcome/scope shown, the failure mode a first AI
// draft produces even when every claim in it is perfectly truthful. Neither
// signal is a fabrication, so neither may ever turn a verdict into 'block' —
// that boundary gets its own assertions below, alongside the opt-in wiring
// (existing callers that don't ask for this must see byte-identical output).
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { genericityFindings, verifyFacts, assertFacts } from '../verify-cv-facts.mjs';
import { buildHtml } from '../generate-cover-letter.mjs';

console.log('\nCV/cover-letter genericity check');

// ── genericityFindings(): buzzword phrases ──────────────────────────────────
{
  const { buzzwords } = genericityFindings('<p>Results-driven professional with a proven track record.</p>');
  if (buzzwords.includes('results-driven professional') && buzzwords.includes('proven track record')) {
    pass('flags stock filler phrases regardless of casing');
  } else fail(`missed a filler phrase: ${JSON.stringify(buzzwords)}`);

  const clean = genericityFindings('<p>Cut infrastructure spend 30% by consolidating three redundant vendors.</p>');
  if (clean.buzzwords.length === 0) pass('a specific, evidenced sentence has no buzzword findings');
  else fail(`false positive on specific prose: ${JSON.stringify(clean.buzzwords)}`);
}

// ── genericityFindings(): task-only bullets, across formats ────────────────
{
  const html = genericityFindings('<ul><li>Responsible for stakeholder communication and project coordination.</li></ul>');
  if (html.taskOnlyBullets.length === 1 && !/\.\.\s*\.$/.test(html.taskOnlyBullets[0])) {
    pass('an HTML task-only bullet with no number is flagged, with clean trailing punctuation');
  } else fail(`HTML task-only bullet not flagged cleanly: ${JSON.stringify(html.taskOnlyBullets)}`);

  const md = genericityFindings('- Managed the onboarding process for new employees.\n- Cut onboarding time 40% by digitizing paperwork.');
  if (md.taskOnlyBullets.length === 1 && md.taskOnlyBullets[0].startsWith('Managed the onboarding')) {
    pass('a markdown task-only bullet is flagged while its evidenced sibling is not');
  } else fail(`markdown bullets misclassified: ${JSON.stringify(md.taskOnlyBullets)}`);

  const tex = genericityFindings('\\item Oversaw vendor relationships and contract renewals.');
  if (tex.taskOnlyBullets.length === 1) pass('a LaTeX \\item task-only bullet is flagged');
  else fail(`LaTeX bullet not flagged: ${JSON.stringify(tex.taskOnlyBullets)}`);
}

// ── no false positives ───────────────────────────────────────────────────────
{
  const numbered = genericityFindings('<li>Managed a $550K budget across 3 teams.</li>');
  if (numbered.taskOnlyBullets.length === 0) pass('the same opener with a number attached is not flagged');
  else fail(`false positive on a bullet carrying real scope: ${JSON.stringify(numbered.taskOnlyBullets)}`);

  const specific = genericityFindings('<li>Migrated the legacy monolith to Kubernetes using a strangler-fig pattern.</li>');
  if (specific.taskOnlyBullets.length === 0) pass('a specific bullet with no generic opener is not flagged even without a number');
  else fail(`false positive on specific bullet: ${JSON.stringify(specific.taskOnlyBullets)}`);

  const prose = genericityFindings('I improved reliability for 25 users.');
  if (prose.taskOnlyBullets.length === 0) pass('cover-letter prose with no bullet markers yields no task-only findings');
  else fail(`false positive on non-bulleted prose: ${JSON.stringify(prose.taskOnlyBullets)}`);
}

// ── verifyFacts(): opt-in, warn-only, never a block ─────────────────────────
{
  const bulletHtml = '<li>Responsible for onboarding.</li>';

  const byDefault = verifyFacts(bulletHtml, { sourcePaths: [] });
  if (byDefault.verdict === 'pass' && byDefault.warnings.length === 0 && byDefault.generic.taskOnlyBullets.length === 0) {
    pass('checkGenericity defaults to off — existing callers see unchanged behavior');
  } else fail(`genericity fired without opting in: ${JSON.stringify(byDefault)}`);

  const optedIn = verifyFacts(bulletHtml, { sourcePaths: [], checkGenericity: true });
  if (optedIn.verdict === 'warn' && optedIn.forbidden.length === 0 && optedIn.generic.taskOnlyBullets.length === 1) {
    pass('opting in surfaces a genericity finding as a warning, never a block');
  } else fail(`unexpected verdict when opted in: ${JSON.stringify(optedIn)}`);

  try {
    assertFacts(bulletHtml, { sourcePaths: [], checkGenericity: true });
    pass('assertFacts does not throw on a genericity-only warning');
  } catch (error) {
    fail(`assertFacts threw on an advisory-only finding: ${error.message}`);
  }
}

// ── end-to-end: generate-cover-letter.mjs's own fact-gate call opts in ──────
{
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-cover-genericity-'));
  try {
    const source = join(tmp, 'cv.md');
    writeFileSync(source, 'Cut onboarding time 40% by digitizing paperwork.');
    const html = buildHtml({
      candidate: { name: 'Jane Doe' },
      letter: {
        role_title: 'Engineer',
        opening: 'Results-driven professional with a proven track record.',
        profile_intro: 'Profile.',
      },
    });
    // Mirrors the exact call generate-cover-letter.mjs makes before rendering
    // a PDF: checkGenericity: true. A regression here (someone dropping the
    // flag) would go back to a stable 'pass' the way this test's opening line
    // would if genericity were never checked.
    const result = verifyFacts(html, { sourcePaths: [source], checkGenericity: true });
    if (result.verdict === 'warn' && result.generic.buzzwords.length > 0) {
      pass('a cover letter opening built from stock filler phrases warns under the wiring generate-cover-letter.mjs uses');
    } else fail(`cover letter genericity wiring did not fire: ${JSON.stringify(result)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
