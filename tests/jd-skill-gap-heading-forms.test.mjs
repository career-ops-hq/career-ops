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
