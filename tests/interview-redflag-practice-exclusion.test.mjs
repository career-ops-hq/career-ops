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
  /Stale red-flag file check/.test(step1) && /for each existing `interview-prep\/\*-redflags\.md`/.test(step1) && /No eligible session belongs to that company/i.test(step1),
  'stale-file check missing');
// A filename cannot tell acme-corp + senior-engineer from acme + corp-senior-engineer,
// so the check matches a known red-flag slug against front matter first.
check('Stale check matches the company by front matter, filename prefix only as fallback',
  /front matter `company`, slugified, equals the slug/.test(step1) && /filename starts with `\{company-slug\}-`/.test(step1),
  'company match still parsed from the filename');
// /career-ops interview is the CV onboarding interview; debriefs come from interview/debrief.
check('Onboarding messages point to /career-ops interview/debrief, not the CV interview',
  (threshold.match(/`\/career-ops interview\/debrief`/g) || []).length === 2 && !/`\/career-ops interview`/.test(threshold),
  'threshold messages still name /career-ops interview');
check('Stale red-flag file is deleted only on the user\'s explicit yes',
  /offer to delete it/.test(step1) && /Delete it only on the user's explicit yes/.test(step1),
  'deletion not gated on consent');
// A kept stale file still feeds oferta's Risk Summary, so it carries a note saying
// its warning level is unverified (added once, dropped when Step 5 rewrites it).
check('A kept stale red-flag file gets an unverified note under its heading, once',
  /add this note on the line below its `# Red-Flag Analysis` heading/.test(step1) &&
    /skip it if the note is already there/.test(step1) &&
    /Unverified: this analysis may rest on practice or mock sessions/.test(step1) &&
    /rewrites the file in Step 5, which drops the note/.test(step1),
  'kept file is left unmarked');
check('Practice-only exit runs the stale red-flag file check',
  /run the stale red-flag file check \(Step 1\) before exiting/.test(threshold), 'practice-only exit skips the check');
check('Step 5 replaces an existing -redflags.md instead of keeping it',
  /Create it if absent, and replace it if present/.test(mode), 'replace rule missing');

check('Minimum Threshold counts eligible sessions, not any file',
  /at least \*\*1\*\* eligible session file/.test(threshold) && /`README\.md` is not a session/.test(threshold),
  'threshold still counts every file');
check('Minimum Threshold has its own message when only practice or mock sessions exist',
  /every one is a practice or mock session/.test(threshold) && /Only practice or mock sessions found/.test(threshold),
  'practice/mock-only message missing');
// mock is a separate source value; its questions were not necessarily asked by the AI.
check('Practice/mock-only message does not say every mock question came from the AI',
  !/questions in a (practice|mock) session were asked by the AI/.test(threshold) && /in a practice session the AI asks the questions/.test(threshold),
  'message still attributes mock questions to the AI');

check('Dependency no longer lists practice.md as a transcript source',
  !/Requires transcripts produced by `modes\/interview\/debrief\.md` or `modes\/interview\/practice\.md`/.test(dependency),
  'practice.md still named as a source');
check('Dependency explains why practice sessions are skipped',
  /AI's own mock questions/.test(dependency), 'no reason given');
