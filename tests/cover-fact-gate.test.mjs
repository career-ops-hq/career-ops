// Cover-letter PDF generation must reject unsupported metric claims before
// importing Playwright or creating an output artifact.
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { assertFacts, verifyFacts } from '../verify-cv-facts.mjs';
import { buildHtml } from '../generate-cover-letter.mjs';

console.log('\nCover letter fact gate');

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-cover-facts-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(source, 'Improved reliability for 25 users.');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: ['maybe'] }));
  const payload = {
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'Engineer',
      opening: 'I improved reliability for 25 users.',
      profile_intro: 'Profile.',
    },
  };
  const html = buildHtml(payload);

  try {
    const result = verifyFacts(html, { sourcePaths: [source], configPath: config, label: 'cover letter' });
    if (result.verdict !== 'pass' || !Array.isArray(result.warnings)) {
      fail(`source-backed cover letter returned an unstable verdict: ${JSON.stringify(result)}`);
    } else {
      pass('source-backed cover letter returns a stable pass verdict');
    }
    assertFacts(html, { sourcePaths: [source], configPath: config, label: 'cover letter' });
    pass('cover letter with source-backed metrics passes the shared fact gate');
  } catch (error) {
    fail(`cover letter fact gate rejected a source-backed metric: ${error.message}`);
  }

  const invented = buildHtml({
    ...payload,
    letter: { ...payload.letter, opening: 'I improved reliability for 26 users.' },
  });
  try {
    const result = verifyFacts(invented, { sourcePaths: [source], configPath: config, label: 'cover letter' });
    if (result.verdict !== 'block' || !Array.isArray(result.warnings)) {
      fail(`unsupported cover letter returned an unstable verdict: ${JSON.stringify(result)}`);
    } else {
      pass('unsupported cover letter returns a stable block verdict');
    }
    assertFacts(invented, { sourcePaths: [source], configPath: config, label: 'cover letter' });
    fail('cover letter fact gate allowed an unsupported metric');
  } catch (error) {
    if (/26 users/.test(error.message)) pass('cover letter fact gate rejects unsupported metrics');
    else fail(`cover letter fact gate failed with the wrong error: ${error.message}`);
  }

  const advisory = verifyFacts('Maybe this wording needs a human review.', { sourcePaths: [source], configPath: config });
  if (advisory.verdict === 'warn' && advisory.warnings.includes('maybe')) {
    pass('advisory phrases return a stable warn verdict without blocking');
  } else {
    fail(`advisory phrase returned the wrong verdict: ${JSON.stringify(advisory)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
