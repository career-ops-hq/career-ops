#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';

export const APPLICATION_ANSWERS_HEADING = '## Application Answers';

const VALID_STATES = new Set(['filled', 'submitted']);

function inline(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function valueText(value) {
  if (Array.isArray(value)) return value.map(inline).filter(Boolean).join(', ');
  return String(value ?? '').trim();
}

function pick(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (Array.isArray(value)) {
      if (value.length > 0) return value;
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(state) {
  const normalized = inline(state || 'filled').toLowerCase();
  if (!VALID_STATES.has(normalized)) {
    throw new Error(`Application answer state must be one of: ${[...VALID_STATES].join(', ')}`);
  }
  return normalized;
}

function normalizeDate(date) {
  return inline(date || new Date().toISOString().slice(0, 10));
}

function quoteBlock(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '> Not recorded.';
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

function qaLines(entries, { labelKeys, valueKeys, fallback }) {
  if (entries.length === 0) return ['- None captured.'];

  return entries.flatMap((entry, index) => {
    const label = inline(pick(entry, labelKeys)) || `${fallback} ${index + 1}`;
    const answer = pick(entry, valueKeys);
    return [
      `${index + 1}. **${label}**`,
      '',
      quoteBlock(answer),
      '',
    ];
  }).slice(0, -1);
}

function compactLines(entries, { labelKeys, valueKeys, fallback }) {
  if (entries.length === 0) return ['- None captured.'];

  return entries.map((entry, index) => {
    const label = inline(pick(entry, labelKeys)) || `${fallback} ${index + 1}`;
    const value = valueText(pick(entry, valueKeys)) || 'Not recorded';
    return `${index + 1}. **${label}:** ${value}`;
  });
}

function fileLines(entries) {
  if (entries.length === 0) return ['- None captured.'];

  return entries.map((entry, index) => {
    const label = inline(pick(entry, ['field', 'name', 'label', 'type'])) || `File ${index + 1}`;
    const file = inline(pick(entry, ['path', 'file', 'filename', 'url'])) || 'Not recorded';
    const version = inline(pick(entry, ['version', 'variant']));
    return `${index + 1}. **${label}:** ${version ? `${file} (${version})` : file}`;
  });
}

export function normalizeApplicationAnswersSnapshot(snapshot = {}) {
  return {
    date: normalizeDate(snapshot.date),
    state: normalizeState(snapshot.state),
    freeText: list(snapshot.freeText ?? snapshot.freeTextAnswers ?? snapshot.answers),
    selections: list(snapshot.selections ?? snapshot.selectedOptions),
    fieldValues: list(snapshot.fieldValues ?? snapshot.otherFields ?? snapshot.fields),
    files: list(snapshot.files ?? snapshot.uploads ?? snapshot.filesUsed),
  };
}

export function formatApplicationAnswersSection(snapshot = {}) {
  const normalized = normalizeApplicationAnswersSnapshot(snapshot);
  const lines = [
    APPLICATION_ANSWERS_HEADING,
    '',
    `**Date:** ${normalized.date}`,
    `**State:** ${normalized.state}`,
    '',
    '### Free-text answers',
    '',
    ...qaLines(normalized.freeText, {
      labelKeys: ['question', 'field', 'label', 'prompt'],
      valueKeys: ['answer', 'response', 'value', 'text'],
      fallback: 'Answer',
    }),
    '',
    '### Selections made',
    '',
    ...compactLines(normalized.selections, {
      labelKeys: ['question', 'field', 'label', 'prompt'],
      valueKeys: ['selection', 'selected', 'answer', 'value', 'options'],
      fallback: 'Selection',
    }),
    '',
    '### Other field values',
    '',
    ...compactLines(normalized.fieldValues, {
      labelKeys: ['question', 'field', 'label', 'prompt'],
      valueKeys: ['answer', 'response', 'value', 'text'],
      fallback: 'Field',
    }),
    '',
    '### Files used',
    '',
    ...fileLines(normalized.files),
  ];

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// Reader. The formatter above has been write-only since it shipped: nothing in
// the tree could read a rendered section back, so `modes/apply.md` recovers
// previous answers by grepping reports for a company name. This closes that
// asymmetry so answers become addressable data, the way `contacts.mjs` and
// `assessment-log.mjs` already own both directions of their own formats.
//
// One property is deliberately NOT claimed: byte-equality with the input
// snapshot. The formatter is lossy by design -- `inline()` collapses
// whitespace in labels, `valueText()` joins arrays with ', ', `pick()` discards
// which of the four accepted key spellings was used, and empty values become
// the sentinels 'Not recorded' / '> Not recorded.'. What IS guaranteed, and
// what the tests pin, is that rendering is a fixed point after one pass:
//   parse(format(x)) === parse(format(parse(format(x))))
// ---------------------------------------------------------------------------

const FREE_TEXT_HEADING = '### Free-text answers';
const SELECTIONS_HEADING = '### Selections made';
const FIELD_VALUES_HEADING = '### Other field values';
const FILES_HEADING = '### Files used';

const NONE_CAPTURED = '- None captured.';
const NOT_RECORDED_BLOCK = 'Not recorded.';
const NOT_RECORDED_INLINE = 'Not recorded';

/** Split a rendered section body into its four `###` groups. */
function sliceGroups(body) {
  const order = [
    ['freeText', FREE_TEXT_HEADING],
    ['selections', SELECTIONS_HEADING],
    ['fieldValues', FIELD_VALUES_HEADING],
    ['files', FILES_HEADING],
  ];
  const groups = { freeText: '', selections: '', fieldValues: '', files: '' };

  const marks = order
    .map(([key, heading]) => {
      const re = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
      const hit = re.exec(body);
      return hit ? { key, start: hit.index, end: hit.index + hit[0].length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  marks.forEach((mark, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].start : body.length;
    groups[mark.key] = body.slice(mark.end, stop).trim();
  });

  return groups;
}

/** `1. **Label**` followed by a `>` quote block. */
function parseQaEntries(block, labelKey, valueKey, onSkip) {
  if (!block || block === NONE_CAPTURED) return [];
  const lines = block.split('\n');
  const entries = [];
  let current = null;
  let quoted = [];

  const flush = () => {
    if (!current) return;
    const text = quoted.join('\n').trim();
    entries.push({
      [labelKey]: current,
      [valueKey]: text === NOT_RECORDED_BLOCK ? '' : text,
    });
    current = null;
    quoted = [];
  };

  for (const line of lines) {
    const head = /^\d+\.\s+\*\*(.*)\*\*\s*$/.exec(line);
    if (head) {
      flush();
      current = head[1].trim();
      continue;
    }
    if (current !== null && /^>/.test(line)) {
      quoted.push(line.replace(/^>\s?/, ''));
      continue;
    }
    // Anything else is unreadable: a heading that lost its numbering, or a
    // quote line with no heading to own it. The second case is the dangerous
    // one — those lines are either dropped (no current entry) or absorbed into
    // the PREVIOUS answer, which corrupts an answer the user really did give.
    if (line.trim()) onSkip?.(line);
  }
  flush();
  return entries;
}

/** `1. **Label:** value` on one line. */
function parseCompactEntries(block, labelKey, valueKey, onSkip) {
  if (!block || block === NONE_CAPTURED) return [];
  const entries = [];
  for (const line of block.split('\n')) {
    const hit = /^\d+\.\s+\*\*(.+):\*\*\s*(.*)$/.exec(line);
    if (!hit) { if (line.trim()) onSkip?.(line); continue; }
    const value = hit[2].trim();
    entries.push({
      [labelKey]: hit[1].trim(),
      [valueKey]: value === NOT_RECORDED_INLINE ? '' : value,
    });
  }
  return entries;
}

/** `1. **Label:** path` or `1. **Label:** path (version)`. */
function parseFileEntries(block, onSkip) {
  if (!block || block === NONE_CAPTURED) return [];
  const entries = [];
  for (const line of block.split('\n')) {
    const hit = /^\d+\.\s+\*\*(.+):\*\*\s*(.*)$/.exec(line);
    if (!hit) { if (line.trim()) onSkip?.(line); continue; }
    const raw = hit[2].trim();
    const versioned = /^(.*\S)\s+\(([^()]*)\)$/.exec(raw);
    const file = versioned ? versioned[1].trim() : raw;
    const entry = {
      field: hit[1].trim(),
      path: file === NOT_RECORDED_INLINE ? '' : file,
    };
    if (versioned && versioned[2].trim()) entry.version = versioned[2].trim();
    entries.push(entry);
  }
  return entries;
}

/**
 * Read a rendered `## Application Answers` section back into a snapshot.
 *
 * Returns the same shape `normalizeApplicationAnswersSnapshot` produces, so the
 * result can be handed straight back to `formatApplicationAnswersSection` or
 * merged with a fresh snapshot. Entry keys are the primary spelling accepted by
 * the formatter (`question`/`answer`, `question`/`selection`, `field`/`path`),
 * which is what makes re-rendering a fixed point.
 *
 * @param {string} reportText Full report markdown.
 * @returns {{date: string, state: string, freeText: object[], selections: object[],
 *            fieldValues: object[], files: object[]} | null}
 *          `null` when the report has no Application Answers section.
 */
export function parseApplicationAnswersSection(reportText, { strict = false } = {}) {
  const skipped = [];
  const onSkip = strict ? (line) => skipped.push(line.trim()) : undefined;
  const report = String(reportText ?? '').replace(/\r\n/g, '\n');
  const heading = /^## Application Answers\s*$/m.exec(report);
  if (!heading) return null;

  const afterHeading = heading.index + heading[0].length;
  const nextHeading = /^## .+$/m.exec(report.slice(afterHeading));
  const body = report.slice(
    afterHeading,
    nextHeading ? afterHeading + nextHeading.index : report.length,
  );

  const dateHit = /^\*\*Date:\*\*\s*(.*)$/m.exec(body);
  const stateHit = /^\*\*State:\*\*\s*(.*)$/m.exec(body);
  const groups = sliceGroups(body);

  const snapshot = {
    date: dateHit ? dateHit[1].trim() : '',
    state: stateHit ? stateHit[1].trim().toLowerCase() : '',
    freeText: parseQaEntries(groups.freeText, 'question', 'answer', onSkip),
    selections: parseCompactEntries(groups.selections, 'question', 'selection', onSkip),
    fieldValues: parseCompactEntries(groups.fieldValues, 'question', 'answer', onSkip),
    files: parseFileEntries(groups.files, onSkip),
  };

  if (strict && skipped.length) {
    throw new Error(
      `Application Answers section has ${skipped.length} unreadable ` +
      `${skipped.length === 1 ? 'entry' : 'entries'}: ${skipped.join(' | ')}`,
    );
  }
  return snapshot;
}

/**
 * The locale-invariant discriminator for the evaluation's draft-answers block.
 *
 * REPLACES a `/^## H\) Draft Application Answers$/` heading match, which found
 * the block in 5 of the 19 evaluation modes and returned `null` — documented as
 * "the report has no block" — for the other 14. Neither half of that heading is
 * stable: the LETTER has been both `G)` (12 modes, pending the #3669 re-sync)
 * and `H)` (7 modes), and the NAME is user-facing prose that every localized
 * mode translates. The marker is the one part of the block no mode translates or
 * renumbers, so this reader works before and after that re-sync. Specified in
 * `modes/oferta.md` under "Draft-answers marker (required)".
 *
 * Placement is load-bearing, not cosmetic: a marker counts only when its
 * preceding non-blank line is an `##` heading. Reports carry the posting's full
 * text in `## Job Description (archived verbatim)`, which is untrusted external
 * content (AGENTS.md); without the adjacency rule, a JD containing this literal
 * would hand the posting's own words back as the candidate's draft answers, and
 * `modes/apply.md` adapts whatever comes back into a real submission.
 */
const DRAFT_ANSWERS_MARKER = /^<!--[ \t]*career-ops:draft-answers[ \t]*-->[ \t]*$/m;

/**
 * Legacy path for reports written before the marker existed. It is unambiguous,
 * so it costs nothing to keep, but it recovers English reports only — which is
 * why it is the fallback and not the discriminator. Non-English reports already
 * on disk stay unreadable: recognizing them would mean guessing at a translated
 * heading, and picking the wrong BLOCK carries the same mispairing risk the body
 * parser below refuses to take, one level up.
 */
const CANONICAL_DRAFT_HEADING = /^##\s+H\)\s*Draft Application Answers\s*$/m;

/**
 * The report's JD archive, which is where untrusted text lives.
 *
 * Kept identical to `JD_HEADING_RE` in `check-jd-archive.mjs` (the canonical
 * heading is `## Job Description (archived verbatim)`; the suffix is optional).
 * Deliberately NOT imported from there: that module resolves the data root, the
 * tracker path and the states file at import time, which is far too much to drag
 * into a parser the apply flow calls. If one moves, move both.
 */
const JD_ARCHIVE_HEADING = /^##\s+Job Description\b.*$/im;

/**
 * A lettered report-section heading (`## G)`, `## H)`, ...). Every one of the 19
 * evaluation modes numbers the draft-answers block this way, in every locale —
 * the letters are not translated, only the names are — so requiring one costs
 * nothing and is the same "is this a real report section?" test that
 * `check-jd-archive.mjs`'s NEXT_REPORT_SECTION_RE already applies.
 */
const LETTERED_BLOCK_HEADING = /^##[ \t]+[A-Z]\)/;

/**
 * Offset where the draft-answers body starts, or `null` when the report has no
 * such block.
 *
 * TWO barriers, because a report embeds the posting verbatim and that text is
 * untrusted (AGENTS.md). Whatever comes back from here is adapted by
 * `modes/apply.md` into a real submission, so a JD that can steer this function
 * can put its own words in the candidate's mouth.
 *
 *   1. The search stops at the JD archive heading. Everything from there on is
 *      the employer's text, not the evaluation's.
 *   2. The marker must sit under a LETTERED block heading. Adjacency to any
 *      `##` line is not enough: a pasted JD routinely carries its own markdown
 *      sub-headings (`## Responsibilities`, `## About the role`) — the same
 *      collision `check-jd-archive.mjs` documents from PR #2791 — and one of
 *      those directly above a planted marker would otherwise clear the guard.
 *
 * The first qualifying marker wins, so even inside the searched region the real
 * block outranks anything later. The English fallback is bounded the same way; a
 * JD quoting the canonical heading verbatim must not trigger it either.
 */
function findDraftAnswersBody(report) {
  const jdArchive = JD_ARCHIVE_HEADING.exec(report);
  const searchable = jdArchive ? report.slice(0, jdArchive.index) : report;

  const marker = new RegExp(DRAFT_ANSWERS_MARKER.source, 'gm');
  for (let hit = marker.exec(searchable); hit; hit = marker.exec(searchable)) {
    const preceding = searchable.slice(0, hit.index).split('\n');
    preceding.pop(); // the empty partial line the marker itself starts on
    let i = preceding.length - 1;
    while (i >= 0 && preceding[i].trim() === '') i -= 1;
    if (i >= 0 && LETTERED_BLOCK_HEADING.test(preceding[i])) return hit.index + hit[0].length;
  }
  const heading = CANONICAL_DRAFT_HEADING.exec(searchable);
  return heading ? heading.index + heading[0].length : null;
}

/**
 * Read the evaluation mode's draft application answers block.
 *
 * A DIFFERENT producer and a different format from the section above.
 * `parseApplicationAnswersSection` reads a format this module also writes, so
 * the two halves are pinned to each other. Nothing writes this block from code:
 * `modes/oferta.md` specifies its heading and its marker and nothing about its
 * body, so the bold-question-then-paragraph shape below is a CONVENTION the
 * evaluation happens to emit, not a contract. This reads the convention and
 * degrades to an empty list when it does not hold, rather than guessing: a
 * mispaired question/answer here would be re-submitted to an employer later.
 *
 * Worth reading despite that, because `modes/apply.md` already treats the block
 * as a legitimate base for a real application ("If there is a Section H or
 * `## Application Answers` -> load previous answers as a base"), and until now
 * nothing in the tree could load it outside English. An evaluated report is the
 * one case where answers exist before any form has been seen.
 *
 * Returns the primary key spelling (`question`/`answer`) and omits the keys the
 * block cannot carry, so the result is a partial snapshot that
 * `normalizeApplicationAnswersSnapshot` accepts as-is.
 *
 * @param {string} reportText Full report markdown.
 * @returns {{freeText: object[]} | null} `null` when the report has no draft block.
 */
export function parseDraftAnswersBlockH(reportText) {
  const report = String(reportText ?? '').replace(/\r\n/g, '\n');
  const afterHeading = findDraftAnswersBody(report);
  if (afterHeading === null) return null;

  const nextHeading = /^## .+$/m.exec(report.slice(afterHeading));
  const body = report.slice(
    afterHeading,
    nextHeading ? afterHeading + nextHeading.index : report.length,
  );

  // A question is a line that is ENTIRELY bold. Bold used mid-sentence inside an
  // answer therefore cannot be mistaken for the start of the next question, and
  // the italic parenthetical the mode emits under the heading is not a question.
  const questionLine = /^\*\*(.+?)\*\*\s*$/gm;
  const marks = [...body.matchAll(questionLine)];
  const freeText = [];
  for (const [index, mark] of marks.entries()) {
    const from = mark.index + mark[0].length;
    const to = index + 1 < marks.length ? marks[index + 1].index : body.length;
    const question = mark[1].trim();
    if (!question) continue;
    const answer = body
      .slice(from, to)
      // A trailing horizontal rule closes the report block, it is not an answer.
      .replace(/^\s*-{3,}\s*$/gm, '')
      .trim();
    freeText.push({ question, answer });
  }
  return { freeText };
}

export function upsertApplicationAnswersSection(reportText, snapshot = {}) {
  const report = String(reportText ?? '').replace(/\r\n/g, '\n');
  const section = formatApplicationAnswersSection(snapshot).trimEnd();
  const heading = /^## Application Answers\s*$/m.exec(report);

  if (!heading) {
    return `${report.trimEnd()}\n\n${section}\n`;
  }

  const start = heading.index;
  const afterHeading = start + heading[0].length;
  const nextHeading = /^## .+$/m.exec(report.slice(afterHeading));
  const end = nextHeading ? afterHeading + nextHeading.index : report.length;
  const before = report.slice(0, start).trimEnd();
  const after = report.slice(end).trimStart();

  return [before, section, after].filter(Boolean).join('\n\n') + '\n';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--read') args.read = true;
    else if (arg === '--read-draft') args.readDraft = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[arg.slice(2)] = value;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node application-answers.mjs --report <report.md> --input <answers.json> [--state filled|submitted] [--date YYYY-MM-DD]',
    '       node application-answers.mjs --report <report.md> --read [--strict]',
    '       node application-answers.mjs --report <report.md> --read-draft',
    '',
    'The input JSON may contain: freeText, selections, fieldValues, files, date, state.',
    '--read prints the parsed ## Application Answers snapshot as JSON (null when the section is absent).',
    '--strict makes --read refuse a partially unreadable section, naming every line it could not parse,',
    'instead of skipping it. Recovery callers (modes/apply.md) want the refusal; the default stays total.',
    '--read-draft prints the evaluation mode\'s draft-answers block instead, as a partial snapshot',
    '({"freeText": [...]}), or null when the report has no such block. The block is located by the',
    'locale-invariant <!-- career-ops:draft-answers --> marker, never by its heading: localized modes',
    'translate the name and number it G) or H). Best-effort by construction: modes/oferta.md fixes the',
    'marker and not the body, so an empty freeText means "drafted, unreadable", and --strict does not apply.',
  ].join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.strict && !args.read) {
    console.error(`--strict only applies to --read.\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (args.read && args.readDraft) {
    console.error(`--read and --read-draft print different sections; pass one.\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (args.readDraft) {
    if (args.input || args.state || args.date) {
      console.error(`--read-draft is read-only and takes no --input, --state or --date.\n\n${usage()}`);
      process.exitCode = 1;
      return;
    }
    if (!args.report) {
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    // No strict counterpart on purpose. Block H's body is a convention, not a
    // format this module writes, so "I could not read a line" is an expected
    // outcome rather than a corrupted report worth refusing over.
    const reportText = readFileSync(resolve(args.report), 'utf-8');
    console.log(JSON.stringify(parseDraftAnswersBlockH(reportText), null, 2));
    return;
  }
  if (args.read) {
    if (args.input || args.state || args.date) {
      console.error(`--read is read-only and takes no --input, --state or --date.\n\n${usage()}`);
      process.exitCode = 1;
      return;
    }
    if (!args.report) {
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    // strict throws with a message naming every unreadable line; main().catch
    // prints it to stderr and sets a non-zero exit code, which is the contract
    // modes/apply.md keys on. A report without the section prints null.
    const reportText = readFileSync(resolve(args.report), 'utf-8');
    const snapshot = parseApplicationAnswersSection(reportText, { strict: args.strict === true });
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  if (!args.report || !args.input) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const inputText = args.input === '-' ? readFileSync(0, 'utf-8') : readFileSync(resolve(args.input), 'utf-8');
  const input = JSON.parse(inputText);
  const snapshot = {
    ...input,
    date: args.date || input.date,
    state: args.state || input.state,
  };
  const reportPath = resolve(args.report);
  const updated = upsertApplicationAnswersSection(readFileSync(reportPath, 'utf-8'), snapshot);
  writeFileSync(reportPath, updated, 'utf-8');

  const normalized = normalizeApplicationAnswersSnapshot(snapshot);
  console.log(JSON.stringify({ report: reportPath, date: normalized.date, state: normalized.state }, null, 2));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
