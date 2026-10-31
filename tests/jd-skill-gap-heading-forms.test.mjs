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

// Headings with qualifiers (e.g. "Role Qualifications", "Minimum Qualifications")
// and experience/skills/abilities permutations (#6255 Item 5).
test('qualified qualification headings like "Role Qualifications" are recognized', () => {
  assertExtracts(`Role Qualifications${BULLETS}`, 'role-qualifications');
  assertExtracts(`## Role Qualifications\n${BULLETS}`, 'markdown-role-qualifications');
  assertExtracts(`**Role Qualifications**\n${BULLETS}`, 'bold-role-qualifications');
  assertExtracts(`Minimum Qualifications${BULLETS}`, 'minimum-qualifications');
  assertExtracts(`Basic Qualifications${BULLETS}`, 'basic-qualifications');
  assertExtracts(`Role Requirements${BULLETS}`, 'role-requirements');
  assertExtracts(`Qualifications and Experience${BULLETS}`, 'qualifications-and-experience');
  assertExtracts(`Qualifications & Experience${BULLETS}`, 'qualifications-amp-experience');
  assertExtracts(`Requirements and Skills${BULLETS}`, 'requirements-and-skills');
});

test('experience, skills, and abilities permutations are recognized', () => {
  assertExtracts(`Experience, Skills, and Abilities${BULLETS}`, 'experience-skills-abilities-oxford');
  assertExtracts(`Experience, Skills and Abilities${BULLETS}`, 'experience-skills-abilities-no-oxford');
  assertExtracts(`Experience, Skills, & Abilities${BULLETS}`, 'experience-skills-abilities-ampersand');
  assertExtracts(`Knowledge, Skills, and Abilities${BULLETS}`, 'knowledge-skills-abilities');
  assertExtracts(`Skills and Abilities${BULLETS}`, 'skills-and-abilities');
  assertExtracts(`Skills & Abilities${BULLETS}`, 'skills-amp-abilities');
  assertExtracts(`Experience and Skills${BULLETS}`, 'experience-and-skills');
  assertExtracts(`Experience & Skills${BULLETS}`, 'experience-amp-skills');
  assertExtracts(`Skills, Experience, and Abilities${BULLETS}`, 'skills-experience-abilities');
});

test('unbulleted requirement sentence is parsed for skills rather than skipped as a heading', () => {
  const jd = '## Requirements\nMinimum qualifications include Python and Kubernetes.\n\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);

  const jdCombo = '## Requirements\nExperience and skills in Python and Kubernetes are required.\n\n- Terraform\n';
  const foundCombo = extractJdSkills(jdCombo).sort();
  assert.deepEqual(foundCombo, ['Kubernetes', 'Python', 'Terraform']);
});

test('multi-section JD with Minimum Qualifications followed by Skills and Abilities extracts skills from both', () => {
  const jd = '## Minimum Qualifications\n- Strong Python experience\n## Skills and Abilities\n- Familiarity with Kubernetes\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python']);
});

test('slash separator in heading boundary and trailing required qualifier on combinations are recognized', () => {
  assertExtracts(`Requirements / Qualifications${BULLETS}`, 'requirements-slash-qualifications');
  assertExtracts(`Requirements/Qualifications${BULLETS}`, 'requirements-slash-qualifications-no-space');
  assertExtracts(`Skills and Experience Required${BULLETS}`, 'skills-and-experience-required');
  assertExtracts(`Skills and Experience Requirements${BULLETS}`, 'skills-and-experience-requirements');
  assertExtracts(`Skills and Experience Requirement${BULLETS}`, 'skills-and-experience-requirement');
});

test('four-term combinations are recognized', () => {
  assertExtracts(`Experience, Knowledge, Skills, and Abilities${BULLETS}`, 'exp-know-skills-abilities-oxford');
  assertExtracts(`Experience, Knowledge, Skills and Abilities${BULLETS}`, 'exp-know-skills-abilities-no-oxford');
  assertExtracts(`Experience, Knowledge, Skills, & Abilities${BULLETS}`, 'exp-know-skills-abilities-amp');
  assertExtracts(`Experience, Knowledge, Skills, and Abilities Required${BULLETS}`, 'exp-know-skills-abilities-required');
});

test('qualified label followed by inline text remains requirement content', () => {
  const jd = '## Requirements\nMinimum qualifications: Python and Kubernetes.\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);

  const jdAbout = '## About you\nAbout you: Curious and kind.\n- Python\n';
  const foundAbout = extractJdSkills(jdAbout).sort();
  assert.deepEqual(foundAbout, ['Python']);
});

test('qualified heading with inline requirements extracts inline skills and subsequent bullets', () => {
  const jd = '## Minimum Qualifications: Python and Kubernetes\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);
});

test('slash-separated skill terms like Knowledge / Skills / Abilities are recognized', () => {
  assertExtracts(`## Knowledge / Skills / Abilities\n${BULLETS}`, 'knowledge-slash-skills-slash-abilities');
  assertExtracts(`Knowledge / Skills / Abilities${BULLETS}`, 'unhashed-knowledge-slash-skills');
  assertExtracts(`Skills / Experience${BULLETS}`, 'skills-slash-experience');
  
  const multiSectionJd = `
## Minimum Qualifications
- Python

## Knowledge / Skills / Abilities
- Kubernetes
`;
  const found = extractJdSkills(multiSectionJd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python']);
});
test('dash-separated heading like Experience/Skills - Python and Kubernetes extracts inline skills', () => {
  const jd = 'Experience/Skills - Python and Kubernetes\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);
});

test('inline requirements retain leading unrecognized skill when recognized skills follow', () => {
  const jd = '## Requirements: Gleam and Python\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Gleam', 'Python', 'Terraform']);
});

test('descriptive heading like Who you are does not turn personality into skill candidates', () => {
  const jd = 'Who you are: Collaborative and passionate.\n\n## Requirements\n- Python\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Python']);
});

test('grammatical opener like Proficient preceding recognized skills is excluded', () => {
  const jd = '## Requirements: Proficient in Python and Kubernetes\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);
});

test('recognized multi-word skill phrase like Natural language processing is retained when opener check runs', () => {
  const jd = '## Requirements: Natural language processing and Python\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Natural language processing', 'Python', 'Terraform']);
});

test('extended requirement and qualification headings like "Requirements for this role" are recognized', () => {
  assertExtracts(`Requirements for this role${BULLETS}`, 'requirements-for-this-role');
  assertExtracts(`Requirements for the role:${BULLETS}`, 'requirements-for-the-role-colon');
  assertExtracts(`Qualifications we look for${BULLETS}`, 'qualifications-we-look-for');
  assertExtracts(`## Requirements for this role\n${BULLETS}`, 'markdown-requirements-for-this-role');
  assertExtracts(`Requirement${BULLETS}`, 'singular-requirement');
  assertExtracts(`Qualification${BULLETS}`, 'singular-qualification');
  assertExtracts(`## Requirement\n${BULLETS}`, 'markdown-singular-requirement');
  assertExtracts(`## Qualification\n${BULLETS}`, 'markdown-singular-qualification');
  assertExtracts(`KSA${BULLETS}`, 'ksa-heading');
  assertExtracts(`## KSA\n${BULLETS}`, 'markdown-ksa-heading');
  assertExtracts(`## KSA:\n${BULLETS}`, 'markdown-ksa-colon');
});

test('full-width colon in qualified English heading extracts inline skills', () => {
  const jd = 'Minimum qualifications：Python and Kubernetes\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);
});

test('inline skills on a KSA heading are extracted alongside following bullets', () => {
  const jd = '## KSA: Python and Kubernetes\n- Terraform\n';
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, ['Kubernetes', 'Python', 'Terraform']);
});


