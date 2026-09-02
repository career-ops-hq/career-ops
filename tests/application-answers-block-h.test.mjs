// tests/application-answers-block-h.test.mjs - Block H is a convention, not a format.
//
// `parseApplicationAnswersSection` reads a format this same module writes, so
// the two halves are pinned to each other and a round-trip test is meaningful.
// Block H has no writer in the tree: `modes/oferta.md:622` specifies the heading
// and says nothing about the body, so the bold-question-then-paragraph shape is
// something the evaluation happens to emit. There is no fixed point to assert.
//
// What is asserted instead is that the parser stays inside the block and never
// invents a pairing, because a mispaired question/answer does not fail loudly:
// it gets re-submitted to an employer as if the candidate wrote it.
//
//   - the four ways a naive parser over-reads: the italic parenthetical under
//     the heading, bold used mid-sentence inside an answer, the horizontal rule
//     that closes the block, and the next `## ` section;
//
//   - absence versus unreadability. No Block H returns null; a Block H whose
//     body does not follow the convention returns an empty list. A caller has to
//     be able to tell "nothing was drafted" from "something was drafted and I
//     could not read it", and collapsing both to null hides the second one;
//
//   - the handoff. The result is a partial snapshot, so it must survive being
//     passed straight to formatApplicationAnswersSection, which is the only
//     reason to parse it at all (modes/apply.md loads Block H as a base).
//
// Anti-vacuity: the fixture is asserted to produce entries before any claim
// about what it excluded, otherwise every exclusion assertion passes trivially.

import { pass, fail, run, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\napplication-answers.mjs - Block H draft answers parse into question/answer pairs');

try {
  const {
    formatApplicationAnswersSection,
    parseDraftAnswersBlockH,
  } = await import(pathToFileURL(join(ROOT, 'application-answers.mjs')).href);

  // Every over-read trap in one fixture: the parenthetical, an answer carrying
  // bold mid-sentence, a multi-line answer, the closing rule, and a following
  // `## ` section whose body would look like an answer if the block leaked.
  const report = [
    '# Evaluation: Acme',
    '',
    '## G) Posting Legitimacy',
    'Tier 1.',
    '',
    '## H) Draft Application Answers',
    '',
    '*(Score is 4.6/5, drafting the generic question set.)*',
    '',
    '**Why are you interested in this role?**',
    'Because the mandate matches what I have been building toward.',
    '',
    'A second paragraph that belongs to the same answer.',
    '',
    '**Tell us about a relevant project.**',
    'I tech-led a design system, including its **token** layer.',
    '',
    '---',
    '',
    '## Keywords extracted',
    '**design systems**',
    'Not an answer.',
  ].join('\n');

  const parsed = parseDraftAnswersBlockH(report);

  // Anti-vacuity gate. Everything below asserts what the parser did NOT take,
  // which is satisfied by a parser that takes nothing at all.
  if (!parsed || parsed.freeText.length !== 2) {
    fail(`Block H fixture did not yield its two questions: ${JSON.stringify(parsed)}`);
  } else {
    const [first, second] = parsed.freeText;
    const checks = [
      [first.question === 'Why are you interested in this role?', 'first question text'],
      [
        first.answer === 'Because the mandate matches what I have been building toward.\n\nA second paragraph that belongs to the same answer.',
        'a multi-line answer keeps its paragraph break',
      ],
      [
        !parsed.freeText.some((entry) => entry.question.startsWith('(')),
        'the italic parenthetical under the heading is a note to the reader, not a question',
      ],
      [
        second.answer === 'I tech-led a design system, including its **token** layer.',
        'bold used mid-sentence stays inside the answer it belongs to',
      ],
      [
        !second.answer.includes('---'),
        'the horizontal rule closing the block is not part of the last answer',
      ],
      [
        !JSON.stringify(parsed).includes('Keywords extracted') && !JSON.stringify(parsed).includes('Not an answer'),
        'the block stops at the next `## ` heading',
      ],
    ];
    const broken = checks.filter(([ok]) => !ok).map(([, detail]) => detail);
    if (broken.length === 0) {
      pass('Block H parser reads the convention without over-reading it');
    } else {
      fail(`Block H parser over-read:\n  ${broken.join('\n  ')}\n  got: ${JSON.stringify(parsed)}`);
    }
  }

  // Absence and unreadability are different answers to different questions.
  const noBlock = parseDraftAnswersBlockH('# Evaluation: Acme\n\n## A) Role\nBody.\n');
  const unreadable = parseDraftAnswersBlockH(
    '## H) Draft Application Answers\n\nThe evaluation wrote prose here instead.\n',
  );
  if (noBlock === null && unreadable !== null && unreadable.freeText.length === 0) {
    pass('Block H parser separates "nothing was drafted" from "drafted, but unreadable"');
  } else {
    fail(
      `Block H absence/unreadability collapsed: absent=${JSON.stringify(noBlock)} ` +
      `unreadable=${JSON.stringify(unreadable)}`,
    );
  }

  // A drafted-but-unanswered question is still a question the UI has to show.
  const empty = parseDraftAnswersBlockH('## H) Draft Application Answers\n\n**Why us?**\n');
  if (empty?.freeText.length === 1 && empty.freeText[0].answer === '') {
    pass('Block H parser keeps a question whose answer was left blank');
  } else {
    fail(`Block H parser dropped an unanswered question: ${JSON.stringify(empty)}`);
  }

  // Windows line endings are the same report.
  const crlf = parseDraftAnswersBlockH(report.replace(/\n/g, '\r\n'));
  if (JSON.stringify(crlf) === JSON.stringify(parsed)) {
    pass('Block H parser reads CRLF reports identically');
  } else {
    fail(`Block H parser disagreed with itself on CRLF input: ${JSON.stringify(crlf)}`);
  }

  // The point of parsing: modes/apply.md loads Block H as a base, which means
  // handing the result to the formatter. A shape the formatter drops is useless.
  const rendered = formatApplicationAnswersSection(parsed);
  if (
    rendered.includes('Why are you interested in this role?') &&
    rendered.includes('Tell us about a relevant project.')
  ) {
    pass('Block H output is a partial snapshot the formatter accepts as-is');
  } else {
    fail(`formatApplicationAnswersSection dropped the Block H snapshot:\n${rendered}`);
  }

  // The CLI seam. modes/apply.md drives this module by shelling out, so an
  // export nothing can reach from a mode is unreachable where it is needed.
  const cliTmp = mkdtempSync(join(tmpdir(), 'block-h-cli-'));
  try {
    const reportPath = join(cliTmp, 'report.md');
    const noBlockPath = join(cliTmp, 'no-block.md');
    writeFileSync(reportPath, report, 'utf-8');
    writeFileSync(noBlockPath, '# Evaluation: Acme\n\n## A) Role\nBody.\n', 'utf-8');

    // stderr is piped, not inherited: the refusals below fail BY DESIGN and
    // their messages belong in the assertion, not in the suite's output.
    const cli = (...extra) =>
      run('node', ['application-answers.mjs', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    const cliChecks = [];

    const draftOut = cli('--report', reportPath, '--read-draft');
    cliChecks.push([
      draftOut !== null && JSON.stringify(JSON.parse(draftOut)) === JSON.stringify(parsed),
      '--read-draft must print exactly what the library parse returns',
    ]);

    cliChecks.push([
      cli('--report', noBlockPath, '--read-draft') === 'null',
      '--read-draft on a report without Block H must print null',
    ]);

    cliChecks.push([
      cli('--report', reportPath, '--read-draft', '--read') === null,
      '--read-draft and --read print different sections, so together they must be refused',
    ]);

    cliChecks.push([
      cli('--report', reportPath, '--read-draft', '--strict') === null,
      '--strict has no Block H meaning and must be refused rather than silently ignored',
    ]);

    const broken = cliChecks.filter(([ok]) => !ok).map(([, detail]) => detail);
    if (broken.length === 0) {
      pass('CLI --read-draft exposes the Block H parser at the seam apply mode calls');
    } else {
      fail(`CLI Block H read path broken:\n  ${broken.join('\n  ')}`);
    }
  } finally {
    rmSync(cliTmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
} catch (e) {
  fail(`Block H draft answer tests crashed: ${e.stack || e.message}`);
}
