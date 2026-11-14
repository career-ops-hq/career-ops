// tests/debrief-rerun-order.test.mjs — a debrief re-run must neither duplicate
// the prep-file round entry nor lose a saved transcript (#7035).
//
// #6933 taught Step 9 to ask whether a debrief re-runs an existing session file,
// but two paths still lost or duplicated data:
//   1. Step 8 appended `## Round [N] Debrief` before Step 9 asked, so a re-run
//      left two entries for one interview in the prep file.
//   2. A recall re-run reconstructed the turns and dropped `stated_priorities`,
//      replacing verbatim text saved by an earlier transcript debrief.
// This suite pins the English mode (the source the translations follow):
//   - the existing-session check is its own step, placed before Step 8;
//   - Step 8 replaces the round's entry on a confirmed re-run;
//   - Step 9 reads the earlier answer instead of asking again, and a recall
//     re-run keeps the existing turns and `stated_priorities`.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nDebrief re-run: check before saving, replace the round entry, keep verbatim turns (#7035)');

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const text = readFileSync(join(ROOT, 'modes', 'interview', 'debrief.md'), 'utf8');
const readme = readFileSync(join(ROOT, 'interview-prep', 'sessions', 'README.md'), 'utf8');

function section(heading) {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length);
  // Stop at the next step heading, not at any `## ` line: the Step 8 and
  // Step 9 templates contain `## Round` and `## Q1` inside their fences.
  const next = rest.search(/\n## (Step |Rules)/);
  return next < 0 ? rest : rest.slice(0, next);
}

const CHECK_HEADING = '## Step 1d — Check for an Earlier Debrief of This Round';
const checkPos = text.indexOf(CHECK_HEADING);
const step8Pos = text.indexOf('## Step 8 — Save Debrief');
const step9Pos = text.indexOf('## Step 9 — Write Session Transcript');

check('the existing-session check has its own step', checkPos >= 0, `no "${CHECK_HEADING}" heading`);
check('the existing-session check comes before Step 8', checkPos >= 0 && step8Pos > checkPos, `check at ${checkPos}, Step 8 at ${step8Pos}`);
check('Step 8 still comes before Step 9', step9Pos > step8Pos, `Step 8 at ${step8Pos}, Step 9 at ${step9Pos}`);

const step1d = section(CHECK_HEADING);
check('Step 1d lists the base name and numbered variants', step1d.includes('`-2`') && /base name itself is missing/.test(step1d), 'variant listing lost');
check('Step 1d asks re-run vs separate round', /re-runs one of them or is a separate round/.test(step1d), 'question lost');
check('Step 1d never overwrites silently', /never overwrite silently/.test(step1d), 'no silent-overwrite guard');
check('Step 1d checks the prep file when no session file exists (run stopped after Step 8)',
  /\*\*No file:\*\* check `interview-prep\/\{company-slug\}-\{role-slug\}\.md`/.test(step1d) && /stopped after Step 8/.test(step1d),
  'no prep-file check on the no-file path');

const step8 = section('## Step 8 — Save Debrief');
check('Step 8 replaces the round entry on a confirmed re-run',
  /confirmed a re-run/.test(step8) && /replace that round's existing `## Round \[N\] Debrief/.test(step8),
  'no replace-on-re-run rule');
check('Step 8 does not re-append a salary line on a re-run', /On a re-run, skip the line/.test(step8), 'salary line can duplicate');

const step9 = section('## Step 9 — Write Session Transcript');
const intro = step9.split('\n').find((l) => l.includes('interview-prep/sessions/{company-slug}')) || '';
check('Step 9 uses the Step 1d answer instead of asking again', /Use the Step 1d answer/.test(intro), intro.slice(0, 120));
check('Step 9 no longer lists files after Step 8 has run', !/Before writing, list every existing file/.test(step9), 'old listing sentence still in Step 9');

const rerun = step9.split('\n').find((l) => l.startsWith('**Re-run rule')) || '';
check('Step 9 has a re-run rule', rerun.length > 0, 'no **Re-run rule** paragraph');
check('a recall re-run keeps the existing turns and stated_priorities',
  /`input_source: recall`, keep the file's existing turns and `stated_priorities` exactly as they are/.test(rerun),
  rerun.slice(0, 160));
check('a recall re-run never rewrites an existing turn', /Never rewrite an existing turn from recall/.test(rerun), 'no never-rewrite clause');

const spBullet = step9.split('\n').find((l) => l.includes('`stated_priorities` goes in the front matter')) || '';
check('the stated_priorities rule no longer drops the field on every recall run',
  !/whenever `input_source: recall`/.test(spBullet) && /recall re-run keeps the picked file's existing list/.test(spBullet),
  spBullet.slice(-200));

check('README describes the check as happening before anything is saved', /Before it saves anything/.test(readme), 'README still describes the old order');
check('README says a recall re-run keeps the existing turns', /re-run from recall keeps the file's existing\s+turns and `stated_priorities`/.test(readme), 'README misses the preservation rule');
