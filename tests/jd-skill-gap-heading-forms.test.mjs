// tests/jd-skill-gap-heading-forms.test.mjs — REQUIREMENT_HEADER_RE and
// NON_REQUIREMENT_HEADER_RE must recognize a requirements/benefits heading
// regardless of markdown bold wrapping or contraction, and must never
// misclassify an asterisk-bulleted line as a heading (#4273).
//
// Before this fix, jd-skill-gap.mjs's REQUIREMENT_HEADER_RE required a
// markdown heading (`#{0,6}`) or nothing at all before the keyword phrase,
// so a bolded heading with no `#` — "**What We're Looking For**" — never
// matched, and the whole requirements section silently scanned zero skills.
// A separate defect: the "we're looking for" alternative only recognized the
// contracted form ("we're"/"we re"), never the equally common uncontracted
// "we are". Netflix postings combine both in the same heading, which is how
// the issue was found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { extractJdSkills } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);

// Every case below shares this bullet list; the presence/absence of these
// three names IS the measurement — a passing extraction returns exactly them.
const BULLETS = '\n- Strong Python and Kubernetes experience\n- Familiarity with Terraform\n';
const EXPECTED = ['Python', 'Kubernetes', 'Terraform'].sort();

function assertExtracts(jd, label) {
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, EXPECTED, `${label}: expected ${EXPECTED.join(', ')}, got ${found.join(', ') || '(none)'}`);
}

// The exact four-row table from the issue report.
test('control: the plain contracted heading already worked', () => {
  assertExtracts(`What We're Looking For${BULLETS}`, 'control');
});

test('a bolded heading with no markdown hash is recognized', () => {
  assertExtracts(`**What We're Looking For**${BULLETS}`, 'bold');
});

test('the uncontracted "We Are" form is recognized', () => {
  assertExtracts(`What We Are Looking For${BULLETS}`, 'uncontracted');
});

test('bold AND uncontracted together (the exact Netflix-posting shape) is recognized', () => {
  assertExtracts(`**What We Are Looking For**${BULLETS}`, 'bold+uncontracted');
});

// __double-underscore__ is CommonMark's other strong-emphasis syntax.
test('__double-underscore__ strong emphasis is recognized the same as **double-asterisk**', () => {
  assertExtracts(`__What We're Looking For__${BULLETS}`, 'underscore-bold');
});

// NON_REQUIREMENT_HEADER_RE gets the identical bold-heading fix, for the
// mirrored reason: failing to recognize a bolded "**Benefits**" doesn't drop
// skills, it does the opposite — it leaves a requirements block open across
// the closing heading and sweeps the benefits list into the reported gaps.
test('a bolded non-requirement heading ("**Benefits**") still closes the block', () => {
  const jd = `## Requirements${BULLETS}\n**Benefits**\n- 401k\n- Equity\n`;
  assertExtracts(jd, 'bold-benefits-closes-block');
});

// The regression this fix must not introduce: REQUIREMENT_HEADER_RE's prefix
// stays #{0,6} (not widened to accept `*`), specifically so an
// asterisk-BULLET whose text happens to start with a keyword is never
// misread as a new heading — which would misclassify the bullet and drop
// its own line's skills (a heading match short-circuits before bullet
// extraction runs on that same line).
test('an asterisk bullet whose text starts with a keyword is still a bullet, not a heading', () => {
  const jd = '## Requirements\n* Required: Python and Kubernetes experience\n* Familiarity with Go\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Go', 'Kubernetes', 'Python'],
    `the bullet's own skills must survive: got ${found.join(', ') || '(none)'}`);
});

// A bolded SKILL inside an ordinary bullet was never broken (SKILL_TOKEN_RE
// already skips over `*`), so the bold-stripping fix for headings must not
// touch bullet extraction and accidentally change this.
test('a bolded skill inside a bullet still extracts correctly', () => {
  assertExtracts('## Requirements\n- **Python** and **Kubernetes**\n- **Terraform**\n', 'bold-skill-in-bullet');
});

// #6255: the ^ anchor made the keyword the heading's first word, so a
// qualified noun heading scanned zero skills and reported
// no-requirements-section. Basic/Minimum Qualifications are the Amazon and
// Google templates, so this was not an edge case.
for (const heading of [
  'Basic Qualifications', 'Minimum Qualifications', 'Role Qualifications',
  'Key Requirements', 'Job Requirements', '## Minimum Qualifications:', '**Basic Qualifications**',
  'Knowledge, Skills, and Abilities', 'Experience, Skills, and Abilities', 'Knowledge, Skills & Abilities',
  'Knowledge/Experience, Skills, and Abilities', 'Knowledge / Experience, Skills and Abilities',
]) {
  test(`a qualified requirements heading is recognized: "${heading}"`, () => {
    assertExtracts(`${heading}${BULLETS}`, heading);
  });
}

// The qualifier list is closed on purpose: a prose line that merely ends in
// "requirements" must not open a block in the middle of the duties.
test('a prose line ending in "requirements" does not open a requirements block', () => {
  const jd = 'Responsibilities\nGather and document requirements\n- Kafka and Redis\n';
  assert.deepEqual(extractJdSkills(jd), []);
});

// A qualified keyword only opens a block when it ENDS the heading (or is
// followed by ":" / "("). Otherwise a bare requirement line that happens to
// start with one — "Technical requirements include …" — read as a heading
// and its own skills were dropped.
test('a bare line starting with a qualified keyword is a requirement, not a heading', () => {
  const jd = '## Requirements\n- Experience with Terraform\nTechnical requirements include Python and Kubernetes\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, EXPECTED, `got ${found.join(', ') || '(none)'}`);
});

test('a qualified heading followed by "(" or an inline list still opens the block', () => {
  assertExtracts(`Minimum Qualifications (all required)${BULLETS}`, 'paren');
  assert.deepEqual(extractJdSkills('Key Requirements: Python, Kubernetes, Terraform\n').sort(), EXPECTED);
});

// Closing heading markers still end the heading.
for (const heading of ['## Basic Qualifications ##', '【Basic Qualifications】', '## Knowledge, Skills, and Abilities ##']) {
  test(`a qualified heading with closing markers is recognized: "${heading}"`, () => {
    assertExtracts(`${heading}${BULLETS}`, heading);
  });
}

// A colon line with no list separator now matches as a heading; its known
// skills must survive, and prose after the colon must not become a "skill".
test('a colon requirement line without separators keeps its known skills', () => {
  const jd = '## Requirements\n- Experience with Terraform\nTechnical requirements: Python and Kubernetes\n';
  assert.deepEqual(extractJdSkills(jd).sort(), EXPECTED);
});

test('prose after a requirement-heading colon is not read as skills', () => {
  assert.deepEqual(extractJdSkills('About you: Curious and kind\n- Go\n'), ['Go']);
});

// A qualified heading may carry its list in parentheses, ASCII or full-width.
test('skills in parentheses after a qualified heading are kept', () => {
  assert.deepEqual(extractJdSkills('Basic Qualifications (Python, Kubernetes and Terraform)\n').sort(), EXPECTED);
  assert.deepEqual(extractJdSkills('Basic Qualifications（Python、Kubernetes、Terraform）\n').sort(), EXPECTED);
  assert.deepEqual(extractJdSkills('## Requirements\n- Experience with Terraform\nBasic Qualifications (Python and Kubernetes)\n').sort(), EXPECTED);
});

test('a parenthesised note after a qualified heading adds no skills', () => {
  assert.deepEqual(extractJdSkills('Minimum Qualifications (all required)\n- Go\n'), ['Go']);
});
