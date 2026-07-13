#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

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
    '',
    'The input JSON may contain: freeText, selections, fieldValues, files, date, state.',
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
