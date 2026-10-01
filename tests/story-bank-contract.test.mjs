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

import { splitStoryBlocks, isValidStory, parseStories, STORY_FIELDS } from '../lib/story-bank.mjs';
import { parseStories as matchStarParseStories } from '../match-star.mjs';
import { parseStoryBlocks, classifyStoryBank } from '../story-provenance-check.mjs';
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

const FIXTURES = {
  'long labels': LONG_LABELS,
  'short labels': SHORT_LABELS,
  'no Action': NO_ACTION,
  'empty Action': EMPTY_ACTION,
  'heading only': HEADING_ONLY,
  'table rows only': `# Story Bank\n\n${BLOCK_F_TABLE}\n`,
  'block then table': `# Story Bank\n\n${LONG_LABELS}\n\n${BLOCK_F_TABLE}\n`,
  'valid, invalid, valid': [LONG_LABELS, NO_ACTION, SHORT_LABELS].join('\n\n'),
  'duplicate titles': [LONG_LABELS, LONG_LABELS].join('\n\n'),
  'CRLF line endings': LONG_LABELS.replace(/\n/g, '\r\n'),
  'example in HTML comment': `<!--\n${LONG_LABELS}\n-->`,
  'example in code fence': IN_FENCE,
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
