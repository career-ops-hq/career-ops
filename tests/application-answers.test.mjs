// tests/application-answers.test.mjs — the section must round-trip, not just render.
//
// formatApplicationAnswersSection has been write-only since it shipped: nothing
// in the tree could read a rendered section back, which is why modes/apply.md
// recovers previous answers by grepping reports for a company name. The seams
// that matter, and why each is pinned here:
//
//   - the fixed-point property. Byte-equality with the INPUT snapshot is not
//     achievable and asserting it would be wrong: inline() collapses whitespace
//     in labels, valueText() joins arrays with ', ', pick() discards which of
//     the four accepted key spellings was used, and empty values render as the
//     sentinels 'Not recorded' / '> Not recorded.'. What must hold is that one
//     render normalizes and every render after that is stable:
//         parse(format(x)) === parse(format(parse(format(x))))
//     so a parsed snapshot can be handed straight back to the formatter;
//
//   - entry key spelling. The parser must emit the PRIMARY key the formatter
//     picks first (question/answer, question/selection, field/path), otherwise
//     re-rendering silently falls through to the fallback labels;
//
//   - the four sentinels. '- None captured.' must read back as an empty array,
//     not as an entry titled 'None captured'; the two 'Not recorded' spellings
//     must read back as empty, not as literal answers. The INLINE spelling is
//     the one path that FABRICATES content rather than dropping it, so it is
//     asserted directly rather than left to the fixed point, which is blind to
//     any sentinel that survives its own re-render;
//
//   - section boundaries. parse must agree with upsert about where the section
//     starts and ends, so a report with sections after Application Answers does
//     not leak the following block into files;
//
//   - multi-line answers, which quoteBlock renders one '> ' per line including
//     blank lines, and which are the only genuinely lossless payload here.
//
// Anti-vacuity: a round-trip suite over an empty corpus passes trivially, so the
// corpus is asserted to actually produce entries before any equality is checked.

import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\napplication-answers.mjs — rendered sections parse back into snapshots');

try {
  const {
    formatApplicationAnswersSection,
    applicationAnswersVersion,
    parseApplicationAnswersSection,
    upsertApplicationAnswersSection,
  } = await import(pathToFileURL(join(ROOT, 'application-answers.mjs')).href);

  // ── 1. corpus ────────────────────────────────────────────────────────────
  // Deliberately includes every lossy path: array selections, a missing file
  // version, an empty answer, a multi-line answer, a label carrying a colon,
  // and a non-primary key spelling ('field'/'value' rather than
  // 'question'/'answer') so the normalization is actually exercised.
  const corpus = [
    {
      name: 'full snapshot',
      snapshot: {
        date: '2026-06-30',
        state: 'submitted',
        freeText: [
          { question: 'Why this role?', answer: 'I want to apply production AI agent experience here.' },
          { question: 'Describe a failure', answer: 'Line one.\n\nLine three after a blank.' },
          { question: 'Anything else?', answer: '' },
        ],
        selections: [
          { field: 'Technical areas', selected: ['Node.js', 'Go', 'LLM evaluation'] },
          { question: 'Notice period: current', selection: '30 days' },
          // Appended, not inserted: the index assertions in section 3 pin
          // selections[0]/[1] and files[0]/[1]. Each of these three renders the
          // INLINE sentinel — an entry that EXISTS with an empty value, which
          // compactLines (:74) and fileLines (:84) spell 'Not recorded' and
          // which no other fixture produces.
          { question: 'Work authorization', selection: '' },
        ],
        fieldValues: [
          { field: 'Compensation expectation', value: '$150k base' },
          { question: 'Earliest start date', answer: '' },
        ],
        files: [
          { field: 'CV', path: 'output/acme-cv.pdf', version: 'v3' },
          { field: 'Cover letter', path: 'output/acme-cover-letter.pdf' },
          { field: 'Portfolio', path: '' },
        ],
      },
    },
    {
      name: 'all groups empty',
      snapshot: { date: '2026-01-02', state: 'filled' },
    },
  ];

  // ── 2. fixed point after one normalization pass ──────────────────────────
  let fixedPointFailure = null;
  let observedEntries = 0;

  for (const { name, snapshot } of corpus) {
    const gen1 = parseApplicationAnswersSection(formatApplicationAnswersSection(snapshot));
    const gen2 = parseApplicationAnswersSection(formatApplicationAnswersSection(gen1));
    observedEntries +=
      gen1.freeText.length + gen1.selections.length + gen1.fieldValues.length + gen1.files.length;
    if (JSON.stringify(gen1) !== JSON.stringify(gen2)) {
      fixedPointFailure = { name, gen1, gen2 };
      break;
    }
  }

  if (observedEntries === 0) {
    fail('round-trip corpus produced zero entries — the equality checks below would be vacuous');
  } else if (fixedPointFailure) {
    fail(
      `re-rendering a parsed snapshot is not a fixed point for "${fixedPointFailure.name}":\n` +
      `  gen1: ${JSON.stringify(fixedPointFailure.gen1)}\n` +
      `  gen2: ${JSON.stringify(fixedPointFailure.gen2)}`,
    );
  } else {
    pass(`parse(format(x)) is a fixed point across ${observedEntries} entries in ${corpus.length} snapshots`);
  }

  // ── 3. values survive, with the primary key spelling ─────────────────────
  const parsed = parseApplicationAnswersSection(
    formatApplicationAnswersSection(corpus[0].snapshot),
  );

  const checks = [
    [parsed.date === '2026-06-30', `date: ${parsed.date}`],
    [parsed.state === 'submitted', `state: ${parsed.state}`],
    [parsed.freeText[0]?.question === 'Why this role?', `freeText label: ${parsed.freeText[0]?.question}`],
    [
      parsed.freeText[0]?.answer === 'I want to apply production AI agent experience here.',
      `freeText answer: ${parsed.freeText[0]?.answer}`,
    ],
    [
      parsed.selections[0]?.selection === 'Node.js, Go, LLM evaluation',
      `array selection joined: ${parsed.selections[0]?.selection}`,
    ],
    [
      parsed.selections[1]?.question === 'Notice period: current',
      `label containing a colon: ${parsed.selections[1]?.question}`,
    ],
    [
      parsed.fieldValues[0]?.answer === '$150k base',
      `fieldValue via non-primary keys: ${parsed.fieldValues[0]?.answer}`,
    ],
    [parsed.files[0]?.path === 'output/acme-cv.pdf', `file path: ${parsed.files[0]?.path}`],
    [parsed.files[0]?.version === 'v3', `file version: ${parsed.files[0]?.version}`],
    [
      parsed.files[1] && !('version' in parsed.files[1]),
      `unversioned file must omit version, got: ${JSON.stringify(parsed.files[1])}`,
    ],
  ];

  const broken = checks.filter(([ok]) => !ok).map(([, detail]) => detail);
  if (broken.length === 0) {
    pass('parsed values keep their content and the formatter\'s primary key spelling');
  } else {
    fail(`parser lost or mis-keyed values:\n  ${broken.join('\n  ')}`);
  }

  // ── 4. multi-line answers, including the blank line quoteBlock emits ──────
  const multiline = parsed.freeText[1]?.answer;
  if (multiline === 'Line one.\n\nLine three after a blank.') {
    pass('multi-line answers survive the > quote block, blank lines included');
  } else {
    fail(`multi-line answer corrupted: ${JSON.stringify(multiline)}`);
  }

  // ── 5. the four sentinels read back as absence, not as content ────────────
  const empty = parseApplicationAnswersSection(
    formatApplicationAnswersSection(corpus[1].snapshot),
  );
  const emptyAnswer = parsed.freeText[2]?.answer;
  if (
    empty.freeText.length === 0 &&
    empty.selections.length === 0 &&
    empty.fieldValues.length === 0 &&
    empty.files.length === 0 &&
    emptyAnswer === ''
  ) {
    pass('"- None captured." reads back as [] and "> Not recorded." as an empty answer');
  } else {
    fail(
      `sentinels leaked into data: groups=${JSON.stringify({
        freeText: empty.freeText.length,
        selections: empty.selections.length,
        fieldValues: empty.fieldValues.length,
        files: empty.files.length,
      })} emptyAnswer=${JSON.stringify(emptyAnswer)}`,
    );
  }

  // ── 5b. the inline sentinel, on entries that exist with empty values ─────
  // Distinct from 5, where the GROUP is absent and the BLOCK sentinels render.
  // This is the one sentinel path that fabricates content rather than dropping
  // it: strip either branch and an empty selection round-trips to the literal
  // answer 'Not recorded', which nobody typed. The fixed-point property cannot
  // see that — 'Not recorded' re-renders to 'Not recorded', stable and wrong —
  // so it needs a direct assertion.
  const renderedInline = formatApplicationAnswersSection(corpus[0].snapshot);
  const inlineChecks = [
    [
      renderedInline.includes('**Work authorization:** Not recorded'),
      'formatter did not render the inline sentinel for an empty selection',
    ],
    [
      parsed.selections[2]?.question === 'Work authorization' && parsed.selections[2]?.selection === '',
      `empty selection: ${JSON.stringify(parsed.selections[2])}`,
    ],
    [
      parsed.fieldValues[1]?.question === 'Earliest start date' && parsed.fieldValues[1]?.answer === '',
      `empty field value: ${JSON.stringify(parsed.fieldValues[1])}`,
    ],
    [
      parsed.files[2]?.field === 'Portfolio' && parsed.files[2]?.path === '',
      `empty file path: ${JSON.stringify(parsed.files[2])}`,
    ],
    [
      parsed.files[2] && !('version' in parsed.files[2]),
      `an empty path must not acquire a version: ${JSON.stringify(parsed.files[2])}`,
    ],
  ];

  const inlineBroken = inlineChecks.filter(([ok]) => !ok).map(([, detail]) => detail);
  if (inlineBroken.length === 0) {
    pass('inline "Not recorded" reads back as an empty value, and the entry survives');
  } else {
    fail(`inline sentinel leaked into data:\n  ${inlineBroken.join('\n  ')}`);
  }

  // ── 6. parse agrees with upsert on the section boundary ──────────────────
  const report = [
    '# Evaluation: Acme - Staff Engineer',
    '',
    '## G) Posting Legitimacy',
    'original G content',
    '',
    '## Keywords extracted',
    'agentic systems, node, go',
    '',
  ].join('\n');

  const withSection = upsertApplicationAnswersSection(report, corpus[0].snapshot);
  const trailing = `${withSection}\n## Later Additive Section\nlater content\n`;
  const bounded = parseApplicationAnswersSection(trailing);

  const leaked =
    JSON.stringify(bounded).includes('later content') ||
    JSON.stringify(bounded).includes('Keywords extracted');

  if (!leaked && bounded.files.length === 3 && bounded.date === '2026-06-30') {
    pass('parse stops at the next ## heading, matching upsert\'s own boundary probe');
  } else {
    fail(`section boundary disagreement — leaked=${leaked}, files=${bounded.files.length}`);
  }

  // ── 7. absence is null, not an empty snapshot ────────────────────────────
  if (
    parseApplicationAnswersSection(report) === null &&
    parseApplicationAnswersSection('') === null &&
    parseApplicationAnswersSection(undefined) === null
  ) {
    pass('a report with no Application Answers section parses to null');
  } else {
    fail('missing section did not parse to null');
  }

  // ── 7b. strict mode refuses rather than silently dropping ────────────────
  // Raised by @santifer in review: for apply-mode recovery of the user's own
  // previous answers, a partial parse that silently drops one is worse than a
  // refusal, because the missing answer looks like an answer they never gave.
  // The default stays total — the fixed point above depends on it — so the
  // refusal is opt-in, for the one caller that needs it.
  const clean = upsertApplicationAnswersSection(report, corpus[0].snapshot);
  const mangled = clean
    .replace('2. **Notice period: current:** 30 days', '- **Notice period: current:** 30 days')
    .replace('1. **CV:** output/acme-cv.pdf (v3)', '1. CV: output/acme-cv.pdf (v3)');

  const lenient = parseApplicationAnswersSection(mangled);
  let strictThrew = null;
  try {
    parseApplicationAnswersSection(mangled, { strict: true });
  } catch (e) {
    strictThrew = e.message;
  }
  let strictOnCleanThrew = null;
  try {
    parseApplicationAnswersSection(clean, { strict: true });
  } catch (e) {
    strictOnCleanThrew = e.message;
  }

  const strictChecks = [
    [
      lenient.selections.length === 2 && lenient.files.length === 2,
      `default must keep dropping silently (unchanged behaviour), got ` +
      `${lenient.selections.length} selections / ${lenient.files.length} files`,
    ],
    [strictThrew !== null, 'strict did not throw on a mangled section'],
    [
      strictThrew && /2 unreadable entries/.test(strictThrew),
      `strict message must count what it refused, got: ${strictThrew}`,
    ],
    [
      strictThrew && strictThrew.includes('Notice period') && strictThrew.includes('CV:'),
      `strict message must name the offending lines, got: ${strictThrew}`,
    ],
    [strictOnCleanThrew === null, `strict threw on a well-formed section: ${strictOnCleanThrew}`],
  ];

  const strictBroken = strictChecks.filter(([ok]) => !ok).map(([, detail]) => detail);
  if (strictBroken.length === 0) {
    pass('strict: true refuses an unreadable section; the default is unchanged');
  } else {
    fail(`strict mode contract broken:\n  ${strictBroken.join('\n  ')}`);
  }

  // ── 7c. strict mode covers FREE TEXT too ─────────────────────────────────
  // Raised by @coderabbitai on the strict-mode commit: onSkip was threaded into
  // the selection, field-value and file parsers but not parseQaEntries, so the
  // one group carrying the user's longest prose stayed silently lossy.
  //
  // Free text fails in two ways the compact groups cannot:
  //   (a) a heading that lost its numbering is unreadable, and
  //   (b) its quote lines are then orphaned — absorbed into the PREVIOUS
  //       answer when one is open, dropped entirely when none is.
  // (b) is the worse half: it corrupts an answer the user really did give.
  const freeTextHeadMangled = clean
    .replace('1. **Why this role?**', '**Why this role?**');
  const freeTextMidMangled = clean
    .replace('2. **Describe a failure**', '- **Describe a failure**');

  const lenientHead = parseApplicationAnswersSection(freeTextHeadMangled);
  const lenientMid  = parseApplicationAnswersSection(freeTextMidMangled);

  let freeTextStrictThrew = null;
  try {
    parseApplicationAnswersSection(freeTextHeadMangled, { strict: true });
  } catch (e) {
    freeTextStrictThrew = e.message;
  }
  let midStrictThrew = null;
  try {
    parseApplicationAnswersSection(freeTextMidMangled, { strict: true });
  } catch (e) {
    midStrictThrew = e.message;
  }

  const freeTextChecks = [
    [
      lenientHead.freeText.length === 2,
      `default must still drop the unreadable free-text entry (unchanged), got ` +
      `${lenientHead.freeText.length} entries`,
    ],
    [
      lenientMid.freeText[0]?.answer.includes('Line three after a blank.'),
      'the (b) corruption path is not being exercised: orphaned quote lines ' +
      'should be absorbed into the previous answer under the default parser',
    ],
    [
      freeTextStrictThrew !== null,
      'strict did not throw on a mangled free-text heading',
    ],
    [
      freeTextStrictThrew && freeTextStrictThrew.includes('Why this role?'),
      `strict message must name the unreadable heading, got: ${freeTextStrictThrew}`,
    ],
    [
      midStrictThrew !== null,
      'strict did not throw on a free-text heading that lost its numbering mid-block',
    ],
    [
      midStrictThrew && midStrictThrew.includes('Describe a failure'),
      `strict message must name the mid-block heading, got: ${midStrictThrew}`,
    ],
  ];

  const freeTextBroken = freeTextChecks.filter(([ok]) => !ok).map(([, detail]) => detail);
  if (freeTextBroken.length === 0) {
    pass('strict: true covers free-text answers, not just the compact groups');
  } else {
    fail(`free-text strict contract broken:\n  ${freeTextBroken.join('\n  ')}`);
  }

  // ── 8. the existing formatter contract is untouched ──────────────────────
  // The prompt layer (modes/apply.md) is coupled to this exact rendering and is
  // CI-blind, so a reader PR must not perturb a single byte of output.
  const section = formatApplicationAnswersSection(corpus[0].snapshot);
  if (
    section.includes('## Application Answers') &&
    section.includes('**Date:** 2026-06-30') &&
    section.includes('**State:** submitted') &&
    section.includes('Node.js, Go, LLM evaluation') &&
    section.includes('output/acme-cv.pdf (v3)')
  ) {
    pass('formatter output is unchanged by the addition of the reader');
  } else {
    fail(`formatter output changed:\n${section}`);
  }

  // ── 9. answer versions are content-addressed, not lifecycle-addressed ────
  const normalizedSnapshot = parseApplicationAnswersSection(section, { strict: true });
  const filledVersion = applicationAnswersVersion({ ...normalizedSnapshot, state: 'filled' });
  const submittedVersion = applicationAnswersVersion({
    ...normalizedSnapshot,
    date: '2030-01-01',
    state: 'submitted',
  });
  const changedVersion = applicationAnswersVersion({
    ...normalizedSnapshot,
    freeText: [
      ...normalizedSnapshot.freeText.slice(0, 1),
      { ...normalizedSnapshot.freeText[1], answer: 'A materially different answer.' },
      ...normalizedSnapshot.freeText.slice(2),
    ],
  });

  if (
    /^sha256:[a-f0-9]{64}$/.test(filledVersion) &&
    filledVersion === submittedVersion &&
    changedVersion !== filledVersion
  ) {
    pass('answer version is stable across date/state changes and changes with answer content');
  } else {
    fail(
      `answer version contract broken: filled=${filledVersion} ` +
      `submitted=${submittedVersion} changed=${changedVersion}`,
    );
  }

  // ── 10. CLI persists, verifies, and seals the exact submitted version ─────
  const tempRoot = mkdtempSync(join(tmpdir(), 'career-ops-application-answers-'));
  try {
    const reportPath = join(tempRoot, 'report.md');
    const copiedReportPath = join(tempRoot, 'report-copy.md');
    const inputPath = join(tempRoot, 'answers.json');
    const changedInputPath = join(tempRoot, 'answers-changed.json');
    const privateMarker = 'PRIVATE_ANSWER_VALUE_MUST_NOT_REACH_METADATA';
    const cliSnapshot = {
      date: '2026-08-18',
      state: 'filled',
      freeText: [{ question: 'Private prompt', answer: privateMarker }],
      selections: [{ question: 'Work mode', selection: 'Remote' }],
      fieldValues: [],
      files: [{ field: 'CV', path: 'output/private-cv.pdf', version: 'v1' }],
    };
    const changedSnapshot = {
      ...cliSnapshot,
      state: 'submitted',
      freeText: [{ question: 'Private prompt', answer: `${privateMarker}_CHANGED` }],
    };
    const baseReport = '# Evaluation: Example - Role\n\n## G) Posting Legitimacy\nActive\n';
    writeFileSync(reportPath, baseReport, 'utf-8');
    writeFileSync(inputPath, JSON.stringify(cliSnapshot), 'utf-8');
    writeFileSync(changedInputPath, JSON.stringify(changedSnapshot), 'utf-8');

    const runCli = (args) => spawnSync(
      process.execPath,
      [join(ROOT, 'application-answers.mjs'), ...args],
      { cwd: ROOT, encoding: 'utf-8' },
    );

    const filled = runCli(['--report', reportPath, '--input', inputPath, '--state', 'filled']);
    const filledMeta = filled.status === 0 ? JSON.parse(filled.stdout) : null;
    const verified = runCli(['--verify', reportPath]);
    const verifiedMeta = verified.status === 0 ? JSON.parse(verified.stdout) : null;
    writeFileSync(copiedReportPath, readFileSync(reportPath, 'utf-8'), 'utf-8');
    const copied = runCli(['--verify', copiedReportPath]);
    const copiedMeta = copied.status === 0 ? JSON.parse(copied.stdout) : null;

    const metadataSafe = [filled.stdout, verified.stdout, copied.stdout]
      .every((output) => !output.includes(privateMarker));
    const writeReadbackMatches =
      filledMeta?.answer_version_hash === verifiedMeta?.answer_version_hash &&
      verifiedMeta?.answer_version_hash === copiedMeta?.answer_version_hash &&
      verifiedMeta?.counts?.free_text === 1 &&
      verifiedMeta?.counts?.files === 1;

    if (filled.status === 0 && verified.status === 0 && copied.status === 0 &&
        metadataSafe && writeReadbackMatches) {
      pass('CLI write/verify/copy readback preserves one version without printing answer values');
    } else {
      fail(
        `CLI metadata/readback contract broken: write=${filled.status} verify=${verified.status} ` +
        `copy=${copied.status} safe=${metadataSafe} matches=${writeReadbackMatches}`,
      );
    }

    const submitted = runCli([
      '--report', reportPath, '--input', inputPath, '--state', 'submitted', '--date', '2026-08-19',
    ]);
    const submittedMeta = submitted.status === 0 ? JSON.parse(submitted.stdout) : null;
    const sealedReport = readFileSync(reportPath, 'utf-8');
    const replay = runCli([
      '--report', reportPath, '--input', inputPath, '--state', 'submitted', '--date', '2030-01-01',
    ]);
    const changed = runCli([
      '--report', reportPath, '--input', changedInputPath, '--state', 'submitted',
    ]);
    const downgrade = runCli([
      '--report', reportPath, '--input', inputPath, '--state', 'filled',
    ]);
    const sealedUnchanged = readFileSync(reportPath, 'utf-8') === sealedReport;

    if (
      submitted.status === 0 &&
      submittedMeta?.state === 'submitted' &&
      submittedMeta?.answer_version_hash === verifiedMeta?.answer_version_hash &&
      replay.status === 0 &&
      changed.status !== 0 &&
      downgrade.status !== 0 &&
      sealedUnchanged &&
      !changed.stderr.includes(privateMarker)
    ) {
      pass('CLI seals a submitted version, permits idempotent replay, and refuses mutation/downgrade');
    } else {
      fail(
        `submitted immutability broken: submit=${submitted.status} replay=${replay.status} ` +
        `changed=${changed.status} downgrade=${downgrade.status} unchanged=${sealedUnchanged}`,
      );
    }

    writeFileSync(reportPath, baseReport, 'utf-8');
    const refilled = runCli(['--report', reportPath, '--input', inputPath, '--state', 'filled']);
    const changedTransition = runCli([
      '--report', reportPath, '--input', changedInputPath, '--state', 'submitted',
    ]);
    if (refilled.status === 0 && changedTransition.status !== 0) {
      pass('CLI requires changed content to be persisted as filled before submitted transition');
    } else {
      fail(
        `filled-to-submitted version gate broken: filled=${refilled.status} ` +
        `changed-transition=${changedTransition.status}`,
      );
    }

    const malformedMarker = 'PRIVATE_MALFORMED_ANSWER_MUST_BE_REDACTED';
    writeFileSync(reportPath, [
      baseReport.trimEnd(),
      '',
      '## Application Answers',
      '',
      '**Date:** 2026-08-18',
      '**State:** filled',
      '',
      '### Free-text answers',
      '',
      `> ${malformedMarker}`,
      '',
      '### Selections made',
      '',
      '- None captured.',
      '',
      '### Other field values',
      '',
      '- None captured.',
      '',
      '### Files used',
      '',
      '- None captured.',
      '',
    ].join('\n'), 'utf-8');
    const malformed = runCli(['--verify', reportPath]);
    if (
      malformed.status !== 0 &&
      /1 unreadable entry/.test(malformed.stderr) &&
      !malformed.stdout.includes(malformedMarker) &&
      !malformed.stderr.includes(malformedMarker)
    ) {
      pass('CLI strict-verification errors report structure without leaking malformed answer text');
    } else {
      fail(
        `CLI strict-verification redaction broken: status=${malformed.status} ` +
        `stdout-leak=${malformed.stdout.includes(malformedMarker)} ` +
        `stderr-leak=${malformed.stderr.includes(malformedMarker)}`,
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
} catch (e) {
  fail(`application answers round-trip tests crashed: ${e.stack || e.message}`);
}
