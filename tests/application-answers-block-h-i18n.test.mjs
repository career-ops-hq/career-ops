import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDraftAnswersBlockH } from '../application-answers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** A report whose Block H heading carries `title`. */
const report = (title) => `# Report

## G) Posting Legitimacy

Tier: verified.

## H) ${title}

**Why do you want this role?**

Because the work is close to what I already do.

## Risk Summary

None.
`;

// The five shipped market modes that translate the Block H title, plus the
// three that keep it in English. Each pair is (mode file, heading title) and
// is read from the mode file itself below, so this list cannot drift from the
// modes without the drift test failing.
const LOCALIZED = [
  ['modes/es/oferta.md', 'Borradores de respuestas para la candidatura'],
  ['modes/ru/oferta.md', 'Черновики ответов на форму'],
  ['modes/tr/is-ilani.md', 'Başvuru Formu Taslak Yanıtları'],
  ['modes/zh/oferta.md', '开放性问题拟答草稿'],
  ['modes/zh-TW/oferta.md', '開放式問題擬答草稿'],
];

for (const [mode, title] of LOCALIZED) {
  test(`Block H parses when its title is localized (${mode})`, () => {
    const got = parseDraftAnswersBlockH(report(title));
    assert.ok(got, `returned null — indistinguishable from "this report has no Block H"`);
    assert.equal(got.freeText.length, 1);
    assert.match(got.freeText[0].question, /want this role/);
  });
}

test('the English title still parses', () => {
  const got = parseDraftAnswersBlockH(report('Draft Application Answers'));
  assert.ok(got);
  assert.equal(got.freeText.length, 1);
});

test('each localized title above is the one its mode actually emits', () => {
  // Guards against this suite testing titles the modes no longer use, which
  // would make every case above pass against nothing.
  //
  // A listed mode file that is missing FAILS here rather than being skipped.
  // Skipping defeats the guard in the exact case it exists for: a mode file
  // that moved leaves every case above asserting a hard-coded title that
  // nothing emits any more, and the suite stays green while checking nothing.
  assert.ok(LOCALIZED.length > 0, 'LOCALIZED is empty, so this guard verifies nothing');
  for (const [mode, title] of LOCALIZED) {
    const path = join(ROOT, mode);
    assert.ok(existsSync(path),
      `${mode} is listed in LOCALIZED but is not in the repo — move the entry to the mode's new path, do not delete it`);
    const src = readFileSync(path, 'utf-8');
    assert.ok(src.includes(`## H) ${title}`),
      `${mode} no longer emits "## H) ${title}" — update this suite, do not delete the case`);
  }
});

test('a report with no Block H still returns null', () => {
  assert.equal(parseDraftAnswersBlockH('# Report\n\n## G) Something\n\nbody\n'), null);
});

test('an H marker with no title is not treated as Block H', () => {
  assert.equal(parseDraftAnswersBlockH('# Report\n\n## H)\n\nbody\n'), null);
});

test('a different lettered block is not mistaken for H', () => {
  assert.equal(parseDraftAnswersBlockH(report('x').replace('## H)', '## G)')), null);
});

test('the marker must start the line, so prose mentioning it does not match', () => {
  const prose = '# Report\n\nSee the ## H) Draft Application Answers block.\n';
  assert.equal(parseDraftAnswersBlockH(prose), null);
});
