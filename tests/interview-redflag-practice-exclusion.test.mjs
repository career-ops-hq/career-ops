// tests/interview-redflag-practice-exclusion.test.mjs — interview-redflag must not
// score practice sessions as company behaviour.
//
// modes/interview/practice.md writes its mock sessions to interview-prep/sessions/,
// the directory interview-redflag reads, with `source: practice` and the real
// company slug when the practice was company-specific. In those files
// `**Interviewer:**` is the question the AI asked while role-playing. Without the
// skip, a vague or protected-ground question the AI asked became an "interviewer
// signal" for the company and could reach the 🚩 Reconsider blacklist suggestion.
// interview/plan and interview/practice already skip `source: practice` when they
// read stated_priorities; this pins the same rule for red-flag.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ninterview-redflag: practice and mock sessions are not company evidence');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const mode = readFileSync(join(ROOT, 'modes', 'interview-redflag.md'), 'utf8');
const section = (start, end) => {
  const a = mode.indexOf(start);
  const b = a >= 0 ? mode.indexOf(end, a + start.length) : -1;
  return a >= 0 && b > a ? mode.slice(a, b) : '';
};

const dependency = section('## Dependency', '## Inputs');
const threshold = section('## Minimum Threshold', '## Step 1');
const step1 = section('## Step 1', '## Step 2');

check('Step 1 skips source: practice and source: mock files',
  /Skip every file with `source: practice` or `source: mock`/.test(step1), 'skip rule missing');
check('Step 1 says a skipped file feeds no signal, Step 2c observation or session count',
  /contributes nothing to Steps 2–6/.test(step1) && /no Step 2c observations/.test(step1) && /no session count/.test(step1),
  'skip scope not stated');
check('Step 1 keeps files with no source field (older transcripts) in scope',
  /without a `source` field is treated as a real interview/.test(step1), 'no-source fallback missing');
check('Step 1 excludes the directory README from the session list',
  /except `README\.md`/.test(step1), 'README.md not excluded');

// A -redflags.md written before this rule may rest on practice sessions, and
// oferta's Risk Summary keeps surfacing its warning level until it is replaced.
check('Step 1 checks for a stale -redflags.md when a company has only skipped files',
  /Stale red-flag file check/.test(step1) && /appears only in skipped files/.test(step1) && /\{company-slug\}-redflags\.md/.test(step1),
  'stale-file check missing');
check('Stale red-flag file is deleted only on the user\'s explicit yes',
  /offer to delete it/.test(step1) && /Delete it only on the user's explicit yes/.test(step1),
  'deletion not gated on consent');
check('Practice-only exit runs the stale red-flag file check',
  /run the stale red-flag file check \(Step 1\) before exiting/.test(threshold), 'practice-only exit skips the check');
check('Step 5 replaces an existing -redflags.md instead of keeping it',
  /Create it if absent, and replace it if present/.test(mode), 'replace rule missing');

check('Minimum Threshold counts eligible sessions, not any file',
  /at least \*\*1\*\* eligible session file/.test(threshold) && /`README\.md` is not a session/.test(threshold),
  'threshold still counts every file');
check('Minimum Threshold has its own message when only practice sessions exist',
  /every one is a practice or mock session/.test(threshold) && /Only practice sessions found/.test(threshold),
  'practice-only message missing');

check('Dependency no longer lists practice.md as a transcript source',
  !/Requires transcripts produced by `modes\/interview\/debrief\.md` or `modes\/interview\/practice\.md`/.test(dependency),
  'practice.md still named as a source');
check('Dependency explains why practice sessions are skipped',
  /AI's own mock questions/.test(dependency), 'no reason given');
