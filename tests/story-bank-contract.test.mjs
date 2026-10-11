// tests/story-bank-contract.test.mjs — one story-bank.md contract, for every
// writer and every reader (#4514).
//
// Before: Block F wrote stories as table rows, no mode named an entry format,
// and the readers' two parsers disagreed on what a story is. A story could be
// written, counted by one reader, and invisible to another — and nothing said
// so. These tests pin the contract from both ends:
//
//   1. READERS AGREE. For every fixture, the stories parseStories() accepts
//      are exactly the blocks isValidStory() marks valid, which are exactly
//      the `kind: 'story'` entries parseStoryBlocks() marks valid. Compared as
//      ordered lists of (title, line), not sets, so a duplicate title or a
//      reordering can't hide a mismatch.
//   2. THE TEMPLATE IS THE CONTRACT. The format shown in
//      templates/story-bank.template.md parses as exactly one valid story in
//      both readers, and the template itself contributes none.
//   3. NOTHING IS SILENTLY LOST OR MISATTRIBUTED. Table rows are reported,
//      and their figures stay with their own row.
//   4. THE ENGLISH MODES TEACH THE CONTRACT. The localized mode sets are
//      tracked separately; see the follow-up issue linked from #4514.
//
// Run:  node --test tests/story-bank-contract.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { splitStoryBlocks, isValidStory, parseStories, getField, STORY_FIELDS } from '../lib/story-bank.mjs';
import { parseStories as matchStarParseStories } from '../match-star.mjs';
import { parseStoryBlocks, classifyStoryBank, malformedEntries } from '../story-provenance-check.mjs';
import { analyze } from '../negotiation-roi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'story-bank.template.md'), 'utf-8');

// ── Fixtures ──────────────────────────────────────────────────────────

const LONG_LABELS = `### [Evals] Eval harness rebuild
**Source:** Report #012 — Acme — AI Engineer
**S (Situation):** Evals were manual
**T (Task):** Automate them
**A (Action):** Built a pytest eval harness
**R (Result):** Triage went from days to hours
**Reflection:** Version the golden set early
**Best for questions about:** testing, evals; quality`;

const SHORT_LABELS = `### Plain title, no theme
**Situation:** Legacy pipeline
**Action:** Ran weekly demos
**Result:** Migration approved`;

const NO_ACTION = `### [Gap] Story with no action
**S (Situation):** Something happened
**R (Result):** It went fine`;

// An empty Action must not borrow the next line's value.
const EMPTY_ACTION = `### [Gap] Empty action line
**A (Action):**
**R (Result):** It went fine`;

const HEADING_ONLY = `### [Stub] Heading with nothing under it`;

// A label quoted inside another field's value is not that field. Unanchored,
// this passed isValidStory() with action = "TBD that nobody filled in." —
// on main too, before this module existed (#4684 review, point 1).
const QUOTED_ACTION = `### [Ops] Runbook cleanup
**S (Situation):** The runbook had a line reading **A (Action):** TBD that nobody filled in.
**R (Result):** Fewer pages.`;

const BLOCK_F_TABLE = `| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|-----------------|-----------------|---|---|---|---|------------|
| 1 | LLM evals | Eval harness rebuild | Manual evals | Automate | Built a harness | Faster triage | Version early |
| 2 | Stakeholders | Migration buy-in | Legacy | Sign-off | Ran demos for 200 employees | Approved | Demo sooner |`;

// The #944-era template verbatim: its example sat inside an HTML comment and
// used to parse as a phantom story titled "Story Title".
const OLD_944_TEMPLATE = `# Story Bank — Master STAR+R Stories

## Stories

<!-- Stories will be added here as you evaluate offers -->
<!-- Format:
### [Theme] Story Title
**Source:** Report #NNN — Company — Role
**S (Situation):** ...
**T (Task):** ...
**A (Action):** ...
**R (Result):** ...
**Reflection:** What I learned / what I'd do differently
**Best for questions about:** [list of question types this story answers]
-->`;

const IN_FENCE = '```markdown\n' + LONG_LABELS + '\n```';

// CommonMark fences (§4.5): a fence closes only on the SAME character, a run
// at least as long as the opening, and nothing but whitespace after it. The
// first version closed any fence on any ``` line, so a ``` inside a ````
// fence ended it early, the outer ```` then opened a new fence, and every
// story after it vanished (FENCE_UNBALANCED_INNER). With a balanced inner
// pair the miscount cancelled out, but a ### inside the fence leaked out as a
// phantom story (FENCE_HIDDEN_HEADING).
const FENCE_UNBALANCED_INNER = '````markdown\nTo open a code block, type:\n```js\n````\n\n' + SHORT_LABELS;
const FENCE_HIDDEN_HEADING = '````\n```\n' + NO_ACTION.replace('### [Gap] Story with no action', '### [Fake] Inside the fence') + '\n**A (Action):** hidden\n```\n````\n\n' + SHORT_LABELS;
const FENCE_TRAILING_TEXT = '```\n``` is not a closing fence\n' + LONG_LABELS + '\n```\n\n' + SHORT_LABELS;
const FENCE_INDENTED_FOUR = '    ```\n' + SHORT_LABELS;
// A backtick run whose info string contains a backtick is inline code, not a
// fence (```a`b``` at the start of a line), so the story after it is visible.
const FENCE_INLINE_CODE = '```a`b```\n' + SHORT_LABELS;

const FIXTURES = {
  'long labels': LONG_LABELS,
  'short labels': SHORT_LABELS,
  'no Action': NO_ACTION,
  'empty Action': EMPTY_ACTION,
  'heading only': HEADING_ONLY,
  'Action label quoted inside another field': QUOTED_ACTION,
  'table rows only': `# Story Bank\n\n${BLOCK_F_TABLE}\n`,
  'block then table': `# Story Bank\n\n${LONG_LABELS}\n\n${BLOCK_F_TABLE}\n`,
  'valid, invalid, valid': [LONG_LABELS, NO_ACTION, SHORT_LABELS].join('\n\n'),
  'duplicate titles': [LONG_LABELS, LONG_LABELS].join('\n\n'),
  'CRLF line endings': LONG_LABELS.replace(/\n/g, '\r\n'),
  'example in HTML comment': `<!--\n${LONG_LABELS}\n-->`,
  'example in code fence': IN_FENCE,
  '4-backtick fence with an unbalanced ``` inside': FENCE_UNBALANCED_INNER,
  '### inside a 4-backtick fence': FENCE_HIDDEN_HEADING,
  'fence line with trailing text does not close': FENCE_TRAILING_TEXT,
  'backticks indented 4 spaces are not a fence': FENCE_INDENTED_FOUR,
  'inline code at line start is not a fence': FENCE_INLINE_CODE,
  '#944 template': OLD_944_TEMPLATE,
  'current template': TEMPLATE,
};

// ── Helpers ───────────────────────────────────────────────────────────

/** Identity of a story: title AND heading line, so two same-titled blocks
 *  are two keys and a swap between them is a mismatch. */
const key = (b) => `${b.title}@${b.line}`;

/** The template's example block, taken from inside its code fence. */
function templateExample() {
  const m = TEMPLATE.match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(m, 'templates/story-bank.template.md has no ```markdown example');
  return m[1];
}

// ── 1. Readers agree ──────────────────────────────────────────────────

for (const [name, content] of Object.entries(FIXTURES)) {
  test(`readers agree on which stories exist: ${name}`, () => {
    // The shared rule's verdict…
    const expected = splitStoryBlocks(content).blocks.filter(isValidStory).map(key);

    // …must be exactly what match-star / negotiation-roi accept…
    assert.deepEqual(parseStories(content).map(key), expected, 'parseStories ≠ isValidStory');

    // …and exactly what the provenance checker marks valid. Its invalid
    // entries and table rows are extra coverage, not extra stories.
    const provenanceValid = parseStoryBlocks(content).filter((e) => e.kind === 'story' && e.valid);
    assert.deepEqual(provenanceValid.map(key), expected, 'parseStoryBlocks valid ≠ isValidStory');

    // Every story parseStories returns satisfies the shared rule, by
    // construction, and has the Action the rule saw.
    for (const s of parseStories(content)) assert.ok(s.action, `"${s.title}" accepted with no Action`);
  });
}

test('match-star and negotiation-roi read through the shared parser', () => {
  assert.equal(matchStarParseStories, parseStories, 'match-star re-exports a different parseStories');
  assert.equal(analyze(FIXTURES['table rows only'], '').storiesScanned, 0);
  assert.equal(analyze(LONG_LABELS, '').storiesScanned, 1);
});

test('a field label counts only at the start of a line', () => {
  assert.equal(parseStories(QUOTED_ACTION).length, 0, 'a quoted **A (Action):** made the story valid');
  assert.equal(
    parseStoryBlocks(QUOTED_ACTION).filter((e) => e.kind === 'story' && e.valid).length, 0,
    'the provenance checker counted the quoted Action',
  );

  const action = (line) => getField(line, STORY_FIELDS.action);
  // Accepted: indentation, and ONE list or quote marker before the label.
  for (const line of ['**A (Action):** x', '   **A (Action):** x', '- **A (Action):** x', '* **A (Action):** x',
    '+ **A (Action):** x', '> **A (Action):** x', '-\t**A (Action):** x', '**Action:** x']) {
    assert.equal(action(line), 'x', `rejected a real field line: ${JSON.stringify(line)}`);
  }
  // Rejected: the label anywhere but the start of the line.
  for (const line of ['**S (Situation):** see **A (Action):** x', 'Note: **A (Action):** x', '-**A (Action):** x']) {
    assert.equal(action(line), '', `accepted a mid-line label: ${JSON.stringify(line)}`);
  }
  // A blank field line doesn't hide a real one further down.
  assert.equal(action('**A (Action):**\n**A (Action):** later'), 'later');
});

test('expected verdicts for the edge fixtures', () => {
  const count = (name) => parseStories(FIXTURES[name]).length;
  assert.equal(count('long labels'), 1);
  assert.equal(count('short labels'), 1);
  assert.equal(count('no Action'), 0);
  assert.equal(count('empty Action'), 0);
  assert.equal(count('heading only'), 0);
  assert.equal(count('table rows only'), 0);
  assert.equal(count('valid, invalid, valid'), 2);
  assert.equal(count('duplicate titles'), 2);
  assert.equal(count('CRLF line endings'), 1);
  assert.equal(count('example in HTML comment'), 0);
  assert.equal(count('example in code fence'), 0);
  assert.equal(count('#944 template'), 0, 'the #944 template example still parses as a phantom story');
});

test('a ``` line inside a ```` fence does not close it (CommonMark §4.5)', () => {
  const titles = (name) => parseStories(FIXTURES[name]).map((s) => s.title);
  // The story after the fence must survive in both readers…
  assert.deepEqual(titles('4-backtick fence with an unbalanced ``` inside'), ['Plain title, no theme']);
  assert.deepEqual(
    parseStoryBlocks(FIXTURES['4-backtick fence with an unbalanced ``` inside']).filter((e) => e.valid).map((e) => e.title),
    ['Plain title, no theme'],
  );
  // …and a ### inside the fence must stay hidden.
  assert.deepEqual(titles('### inside a 4-backtick fence'), ['Plain title, no theme']);
  // A fence line with text after it is content, so the real closing fence
  // still hides the block inside and the story after it stays visible.
  assert.deepEqual(titles('fence line with trailing text does not close'), ['Plain title, no theme']);
  // Four spaces of indentation is an indented code block, not a fence.
  assert.deepEqual(titles('backticks indented 4 spaces are not a fence'), ['Plain title, no theme']);
  // A backtick in a backtick fence's info string makes it inline code.
  assert.deepEqual(titles('inline code at line start is not a fence'), ['Plain title, no theme']);
});

// ── 2. The template is the contract ───────────────────────────────────

test('the template contributes no stories and no table rows', () => {
  const { blocks, tableRows } = splitStoryBlocks(TEMPLATE);
  assert.equal(blocks.length, 0);
  assert.equal(tableRows.length, 0);
});

test('the template example is exactly one valid story in both readers', () => {
  const example = templateExample();
  const [story, ...rest] = parseStories(example);
  assert.equal(rest.length, 0);
  assert.ok(story, 'template example does not parse as a story');

  const entries = parseStoryBlocks(example);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].valid, true);
  assert.equal(entries[0].provenance, null, 'the template must not teach a Provenance line');

  // Every field the readers know is demonstrated, so the template and the
  // label table can't drift apart.
  for (const [field, labels] of Object.entries(STORY_FIELDS)) {
    assert.ok(example.includes(`**${labels[0]}:**`), `template example lacks **${labels[0]}:** (${field})`);
    assert.notEqual(story[field].length, 0, `template example's ${field} is empty`);
  }
});

// ── 3. Nothing silently lost or misattributed ─────────────────────────

test('table rows are reported, and never absorbed into the block above', () => {
  const content = FIXTURES['block then table'];
  const { blocks, tableRows } = splitStoryBlocks(content);
  assert.equal(blocks.length, 1);
  assert.ok(!blocks[0].body.includes('Migration buy-in'), 'table rows leaked into the preceding block');
  assert.deepEqual(tableRows.map((r) => r.label), ['Eval harness rebuild', 'Migration buy-in']);
});

test("a table row's figure is attributed to that row, not the story above", () => {
  const b = classifyStoryBank(FIXTURES['block then table'], '');
  const all = Object.values(b).flat();
  const hit = all.find((c) => c.claim === '200 employees');
  assert.ok(hit, 'the table-row figure was not checked at all');
  assert.match(hit.story, /^\(table row, line \d+\) Migration buy-in$/);
});

// Text after a heading or table inside a story (#4684 review, point 2). The
// story ends there so a table's figures aren't credited to it, but the lines
// below are still in the file and still get checked, as on main.
const HEADING_IN_STORY = `### [Ops] Story
**A (Action):** a
## Notes
**R (Result):** Cut costs by 15%.`;
const TABLE_IN_STORY = `### [Ops] Story
**S (Situation):** s
| x | y |
|---|---|
| 1 | 2 |
**A (Action):** a
**R (Result):** Cut costs by 15%.`;

/** Every classified claim as `bucket: claim @ story`. */
function claimsOf(md, cv = '') {
  return Object.entries(classifyStoryBank(md, cv)).flatMap(([bucket, list]) => list.map((c) => `${bucket}: ${c.claim} @ ${c.story}`));
}

test('a figure after a heading inside a story is still checked', () => {
  assert.deepEqual(claimsOf(HEADING_IN_STORY), ['derivedUnverified: 15% @ (after heading, line 4) in "Story"']);
  const malformed = malformedEntries(parseStoryBlocks(HEADING_IN_STORY));
  assert.deepEqual(malformed.map((m) => m.kind), ['trailing']);
  assert.match(malformed[0].reason, /after a heading/);
});

test('a figure after a table inside a story is still checked, and the story says why it is invalid', () => {
  assert.deepEqual(claimsOf(TABLE_IN_STORY), ['derivedUnverified: 15% @ (after table, line 6) in "Story"']);
  const malformed = malformedEntries(parseStoryBlocks(TABLE_IN_STORY));
  const story = malformed.find((m) => m.kind === 'story');
  assert.match(story.reason, /comes after a table/, 'the story was reported as having no Action at all');
});

test("a story's user-cannot-confirm still covers figures cut off below a table or heading", () => {
  // The decay this guards against: the denial sits on the story, the figure
  // below the cut. Classified on its own, the figure would come back as
  // derived-unverified and ask the user to confirm what they said they can't.
  const marked = (md) => md.replace('**A (Action):** a', '**A (Action):** a\n**Provenance:** user-cannot-confirm');
  for (const md of [HEADING_IN_STORY, TABLE_IN_STORY]) {
    const claims = claimsOf(marked(md));
    assert.equal(claims.length, 1);
    assert.match(claims[0], /^userCannotConfirm: 15% @ \(after /, `the denial decayed: ${claims[0]}`);
  }
  // A marker below the cut covers the story's own figures too.
  const below = '### [Ops] Story\n**A (Action):** grew revenue 30%\n## Notes\n**Provenance:** user-cannot-confirm';
  assert.deepEqual(claimsOf(below), ['userCannotConfirm: 30% @ Story']);
});

test('table rows after a story inherit only its denial, never a confirmation', () => {
  const after = (marker) => `### [Ops] Story\n**A (Action):** a\n**Provenance:** ${marker}\n\n${BLOCK_F_TABLE}\n`;
  const rowClaim = (md) => claimsOf(md).find((c) => c.includes('200 employees'));
  assert.match(rowClaim(after('user-cannot-confirm')), /^userCannotConfirm: /);
  // source: cv.md would launder separate Block F rows into `existing`.
  assert.match(rowClaim(after('source: cv.md')), /^derivedUnverified: /);
});

test('text before the first story belongs to no story and is not scanned', () => {
  const { trailing } = splitStoryBlocks('# Story Bank\n\nAim for 5-10 stories, 100% honest.\n\n' + LONG_LABELS);
  assert.deepEqual(trailing, []);
});

test('npm run star names unreadable table rows instead of "no stories"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-bank-contract-'));
  try {
    mkdirSync(join(dir, 'interview-prep'));
    writeFileSync(join(dir, 'interview-prep', 'story-bank.md'), FIXTURES['table rows only']);
    // match-star reads the bank from the data root, not the cwd (#3985), so
    // point the data root at the fixture rather than relying on where it runs.
    const r = spawnSync(process.execPath, [join(ROOT, 'match-star.mjs'), '--list'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /2 table row\(s\)/);
    assert.match(r.stderr, /templates\/story-bank\.template\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. The English modes teach the contract ───────────────────────────

const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

for (const file of ['modes/oferta.md', 'modes/interview-prep.md', 'modes/interview/debrief.md']) {
  test(`${file} points story appends at the template`, () => {
    assert.ok(read(file).includes('templates/story-bank.template.md'), `${file} names no entry format`);
  });
}

test('oferta.md no longer appends only "if the file exists"', () => {
  assert.doesNotMatch(read('modes/oferta.md'), /If `interview-prep\/story-bank\.md` exists/);
});

test('batch workers are told never to write story-bank.md', () => {
  assert.match(read('batch/batch-prompt.md'), /Never write to `interview-prep\/story-bank\.md`/);
});
