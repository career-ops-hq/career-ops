// tests/story-provenance-gates.test.mjs — a story-bank figure reaches an
// interviewer, a negotiation or an ATS form only on the terms AGENTS.md's
// Source-of-Truth Boundary sets.
//
// Three readers put story-bank figures in front of someone else, and each let
// an unverified one through:
//
//   story-provenance-check.mjs  `existing` matched digits, not units, inside a
//                               window that crossed sentences: a cv.md "40%"
//                               verified a story's "40-person team".
//   negotiation-roi.mjs         never read the Provenance marker, and accepted
//                               "8 hours" and "2 hours" from two unrelated cv.md
//                               bullets as an 8-to-2-hours reduction, so a story
//                               marked user-cannot-confirm became a dollar figure.
//   match-star.mjs              printed a user-cannot-confirm story as paste-ready
//                               ATS text, figures and all, with no warning.
//
// Run:  node --test tests/story-provenance-gates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStoryBank } from '../story-provenance-check.mjs';
import { analyze, verifyClaim } from '../negotiation-roi.mjs';
import { formatAts, parseStories } from '../match-star.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CV = [
  '# Jane Doe',
  '## Experience',
  '### Acme Corp — Remote',
  '**Staff Engineer**',
  '2019 – 2024',
  '- Led the platform engineering team; cut deploy time 40%.',
  '- Provided 8 hours of on-call coverage each week.',
  '- Ran a 2 hours onboarding workshop for new hires.',
  '',
].join('\n');

const SCALING = [
  '### [Leadership] Scaling the platform team',
  '**S (Situation):** The platform team was too small for the roadmap.',
  '**T (Task):** Grow it without losing velocity.',
  '**A (Action):** Hired aggressively, growing to a 40-person team.',
  '**R (Result):** Reduced incident rate 40% and onboarded 500+ customers.',
  '**Reflection:** Hiring is slower than planned.',
  '',
].join('\n');

const REPORTING = [
  '### [Automation] Weekly reporting',
  '**S (Situation):** Weekly reporting was manual.',
  '**T (Task):** Automate it.',
  '**A (Action):** Built a reporting pipeline.',
  '**R (Result):** Cut reporting from 8 hours to 2 hours, weekly, at $60/hr.',
  '**Reflection:** Automate early.',
  '**Best for questions about:** automation, process improvement',
  '**Provenance:** user-cannot-confirm',
  '',
].join('\n');

const bucketOf = (result, claim) => Object.keys(result).find((k) => result[k].some((c) => c.claim === claim));

// ── story-provenance-check ───────────────────────────────────────────

test('a cv.md percentage does not verify a story headcount with the same digits', () => {
  const result = classifyStoryBank(SCALING, CV);
  assert.equal(result.existing.length, 0, `nothing in this story is in cv.md: ${JSON.stringify(result.existing)}`);
  // cv.md does describe a team, just not its size: supported, not verified.
  assert.equal(bucketOf(result, '40-person'), 'supportedByResume');
});

test('a percentage about a different metric, in a different sentence, is not verified', () => {
  const result = classifyStoryBank(SCALING, CV);
  // cv.md's 40% is deploy time; the story's is incident rate. Their only
  // shared word ("team") sat in the neighbouring Action line, not this one.
  assert.equal(bucketOf(result, '40%'), 'derivedUnverified');
  assert.equal(bucketOf(result, '500+ customers'), 'derivedUnverified');
});

test('the same number and unit in context still verifies', () => {
  const bank = SCALING.replace('Reduced incident rate 40%', 'Cut deploy time 40%');
  assert.equal(bucketOf(classifyStoryBank(bank, CV), '40%'), 'existing');
  // A headcount in other words is the same claim: "a team of 40 people".
  const cv = CV.replace('Led the platform engineering team;', 'Grew the platform team to 40 people;');
  assert.equal(bucketOf(classifyStoryBank(SCALING, cv), '40-person'), 'existing');
});

test('a percentage needs shared words about the metric, not one shared word', () => {
  // Same number, same unit, same sentence shape; "team" is the only word the
  // two have in common, and it says nothing about what the 40% measures.
  const bank = '### Story\n**A (Action):** The team reduced incident rate 40%.\n';
  const cv = '- The team cut deploy time 40%.\n';
  assert.notEqual(bucketOf(classifyStoryBank(bank, cv), '40%'), 'existing');
  // A unit that names the metric needs only one placing word.
  const people = classifyStoryBank('### Story\n**A (Action):** Grew the team to 40 people.\n', '- Led a team of 40 people.\n');
  assert.equal(bucketOf(people, '40 people'), 'existing');
});

test('both endpoints of an hour range must sit in one cv.md sentence', () => {
  const bank = REPORTING.replace('**Provenance:** user-cannot-confirm\n', '');
  assert.notEqual(bucketOf(classifyStoryBank(bank, CV), '8 hours to 2 hours'), 'existing',
    'two unrelated bullets verified an 8-to-2-hours reduction');
  const cv = `${CV}- Cut weekly reporting from 8 hours to 2 hours.\n`;
  assert.equal(bucketOf(classifyStoryBank(bank, cv), '8 hours to 2 hours'), 'existing');
});

// ── negotiation-roi ──────────────────────────────────────────────────

test('negotiation-roi never turns a user-cannot-confirm story into a talking point', () => {
  // Even with the numbers in one cv.md sentence: the marker is the user's
  // answer, and it wins over what cv.md happens to contain.
  const cv = `${CV}- Cut weekly reporting from 8 hours to 2 hours.\n`;
  const result = analyze(REPORTING, cv, {});
  assert.equal(result.verified, 0);
  assert.deepEqual(result.calculable, []);
  assert.equal(result.excludedCannotConfirm, 1);
  assert.ok(result.warnings.some((w) => /user-cannot-confirm/.test(w)), result.warnings.join('\n'));
});

test('negotiation-roi needs both hour figures in the same cv.md sentence', () => {
  const claim = { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } };
  assert.equal(verifyClaim(claim, CV).verified, false, '"8 hours of on-call" + "a 2 hours workshop" is not a reduction');
  assert.equal(verifyClaim(claim, 'Cut weekly reporting from 8 hours to 2 hours.').verified, true);

  const unmarked = REPORTING.replace('**Provenance:** user-cannot-confirm\n', '');
  const result = analyze(unmarked, CV, {});
  assert.equal(result.verified, 0);
  assert.equal(result.excludedUnverified, 1);
});

// ── match-star ───────────────────────────────────────────────────────

test('match-star replaces the figures of a user-cannot-confirm story', () => {
  const [story] = parseStories(REPORTING);
  const out = formatAts({ ...story, provenance: 'user-cannot-confirm' }, 'automation', { cvText: CV });
  assert.doesNotMatch(out, /8 hours to 2 hours/);
  assert.match(out, /\[unconfirmed figure\]/);
  assert.match(out, /user-cannot-confirm/);
});

test('match-star masks every number of a user-cannot-confirm story, in every field it prints', () => {
  const bank = REPORTING
    .replace('### [Automation] Weekly reporting', '### [Automation] Weekly reporting, 8h saved')
    .replace('at $60/hr.', 'at $60/hr, saving $40K and 1,200+ tickets, 3x faster in Q3.')
    .replace('automation, process improvement', 'automation, 10x wins');
  const [story] = parseStories(bank);
  const out = formatAts({ ...story, provenance: 'user-cannot-confirm' }, 'automation', { cvText: CV });
  for (const figure of ['8h', '$60/hr', '$40K', '1,200+', '3x', '10x', '8 hours', '2 hours']) {
    assert.ok(!out.includes(figure), `"${figure}" survived the mask:\n${out}`);
  }
  assert.match(out, /in Q3\./, 'a quarter name is not a figure');
});

test('match-star warns once per unverified figure and stays quiet for a verified one', () => {
  const [story] = parseStories(SCALING);
  const out = formatAts({ ...story, provenance: null }, 'leadership', { cvText: CV });
  assert.match(out, /"40%" is not in cv\.md \(derived-unverified\)/);
  assert.match(out, /"500\+ customers" is not in cv\.md/);
  assert.match(out, /"40-person": cv\.md supports the fact but not this figure/);

  const verified = SCALING.replace('Reduced incident rate 40% and onboarded 500+ customers.', 'Cut deploy time 40%.')
    .replace('growing to a 40-person team', 'growing the team');
  const [ok] = parseStories(verified);
  assert.doesNotMatch(formatAts({ ...ok, provenance: null }, 'leadership', { cvText: CV }), /⚠️ {2}"/);
});

test('npm run star reads the marker from the story bank on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-star-provenance-'));
  try {
    mkdirSync(join(dir, 'interview-prep'));
    writeFileSync(join(dir, 'interview-prep', 'story-bank.md'), `# Story Bank\n\n${SCALING}\n${REPORTING}`);
    writeFileSync(join(dir, 'cv.md'), CV);
    const run = spawnSync(process.execPath, [join(ROOT, 'match-star.mjs'), 'Tell me about an automation you built'], {
      cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(run.status, 0, describeSpawn(run));
    assert.match(run.stdout, /Weekly reporting/);
    assert.doesNotMatch(run.stdout, /8 hours to 2 hours/);
    assert.match(run.stdout, /\[unconfirmed figure\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
