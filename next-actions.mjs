#!/usr/bin/env node

/** Local action intake and review. Task commands never submit or update tracker states. */
import { constants, openSync, closeSync, fstatSync, statSync, readSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { isMainModule } from './lib/is-main-module.mjs';
import {
  ActionError, createActionsContext, readActions, importActions, updateAction, listActions,
} from './next-actions-core.mjs';

const USAGE = `Usage:
  node next-actions.mjs list [--all] [--time-zone UTC] [--summary]
  node next-actions.mjs show <id> [--summary]
  node next-actions.mjs add "Title" --evidence "Supporting note" [--actor user|company|unknown]
       [--link https://example.com/form] [--key stable-key] [--dry-run]
  node next-actions.mjs import --file proposals.json [--dry-run]
  node next-actions.mjs accept|done|dismiss|reopen|unbind <id> --revision N --reason "Why"
  node next-actions.mjs edit <id> --revision N --file patch.json --reason "Why"
  node next-actions.mjs bind <id> --revision N --tracker-id N --reason "Why"
  node next-actions.mjs ack-source <id> --revision N --file proposal.json --reason "Why"

Output is JSON unless --summary is supplied. --json is also accepted.
Add/import create proposals. Accept records a reviewed action; done records the
user's stated completion. Neither changes application status or sends anything.
Reopen returns a closed task to review. Ack-source recognizes a reviewed source
variant without changing task content. Read docs/NEXT_ACTIONS.md for schemas.
Without --key, each manual add creates a distinct task. Keep a key for retries.
--dry-run validates a preview; it neither writes nor reserves an ID.
Data: {CAREER_OPS_ROOT or resolved Data Root}/data/next-actions.json`;

const OPTIONS = {
  all: { type: 'boolean' }, summary: { type: 'boolean' }, json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, 'dry-run': { type: 'boolean' },
  'time-zone': { type: 'string' }, file: { type: 'string' }, revision: { type: 'string' },
  reason: { type: 'string' }, 'tracker-id': { type: 'string' }, evidence: { type: 'string' },
  actor: { type: 'string' }, link: { type: 'string' }, key: { type: 'string' },
};
const REVIEW_FLAGS = ['revision', 'reason'];
const COMMAND_FLAGS = {
  list: ['all', 'time-zone'], show: [],
  add: ['evidence', 'actor', 'link', 'key', 'dry-run'], import: ['file', 'dry-run'],
  accept: REVIEW_FLAGS, done: REVIEW_FLAGS, dismiss: REVIEW_FLAGS, reopen: REVIEW_FLAGS,
  unbind: REVIEW_FLAGS, edit: [...REVIEW_FLAGS, 'file'],
  bind: [...REVIEW_FLAGS, 'tracker-id'], 'ack-source': [...REVIEW_FLAGS, 'file'],
};
const INPUT_LIMIT = 1024 * 1024;
const GROUP_LABELS = {
  'needs-review': 'Review', overdue: 'Overdue employer deadlines', 'due-today': 'Due today',
  ready: 'Your next steps', waiting: 'Waiting for the company', snoozed: 'Snoozed',
  done: 'Completed', dismissed: 'Dismissed',
};

function invalid(message) {
  throw new ActionError('VALIDATION', message);
}

// Input is bounded even if it grows after fstat. Never echo a JSON parse snippet:
// source evidence may contain private text, and parser messages can quote it.
function readJsonInput(file) {
  let fd;
  try {
    const initial = statSync(file);
    if (!initial.isFile() || initial.size > INPUT_LIMIT) invalid('Input must be a regular JSON file of at most 1 MiB.');
    // Refuse named pipes before open; nonblocking also covers a POSIX file
    // replaced by a pipe between stat and open. fstat checks the actual handle.
    const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NONBLOCK;
    fd = openSync(file, flags);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > INPUT_LIMIT) invalid('Input must be a regular JSON file of at most 1 MiB.');
    const buffer = Buffer.alloc(INPUT_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
    }
    if (length > INPUT_LIMIT) invalid('Input exceeds 1 MiB.');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
    } catch {
      invalid('Input is not valid UTF-8 JSON.');
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError('IO', 'Cannot read the input file. Check its path and permissions.');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function safeText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
}

function taskLines(task) {
  const due = task.employerDue;
  const dueText = due.kind === 'unknown' ? 'unknown'
    : due.kind === 'instant' ? due.at : `${due.date} (${due.timeZone ?? 'timezone unknown'})`;
  const lines = [
    `${task.id}  rev ${task.revision}  ${task.state}  actor: ${task.actor}`,
    `  ${safeText(task.title)}`,
    `  Employer due: ${safeText(dueText)}`,
  ];
  if (task.targetDate) lines.push(`  Personal target: ${task.targetDate.date} (${safeText(task.targetDate.timeZone)})`);
  if (task.snoozedUntil) lines.push(`  Snoozed until: ${task.snoozedUntil}`);
  if (task.application) lines.push(`  Tracker #${task.application.trackerId}: ${safeText(task.application.company)} / ${safeText(task.application.role)}`);
  if (task.flags) {
    const f = task.flags;
    if (f.employerOverdue) lines.push('  Employer deadline has passed.');
    else if (f.employerDueToday) lines.push('  Employer deadline is today.');
    if (f.targetPast) lines.push('  Your planned date has passed; this is still unfinished.');
    if (f.snoozePastEmployerDue) lines.push('  Snooze extends past the employer deadline.');
    if (f.snoozeOverridden) lines.push('  A reached deadline or personal target keeps this item visible.');
    if (f.bindingLimited) lines.push('  Application identity has limited evidence.');
    if (!['unbound', 'current'].includes(f.bindingState)) lines.push(`  Review application reference: ${safeText(f.bindingState)}.`);
    if (f.ageDays > 0) lines.push(`  Added ${f.ageDays} day(s) ago.`);
  }
  lines.push(`  Evidence: ${safeText(task.evidence.text)}`);
  if (task.evidence.ref) lines.push(`  Source: ${safeText(task.evidence.ref)}`);
  for (const link of task.links) lines.push(`  ${safeText(link.label)}: ${safeText(link.ref)}`);
  return lines;
}

function printResult(result, summary, command) {
  if (!summary) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  let lines;
  if (Array.isArray(result.tasks)) {
    lines = [`Next actions (${safeText(result.timeZone)}): ${result.tasks.length} shown`];
    for (const [bucket, ids] of Object.entries(result.groups)) {
      if (!ids.length) continue;
      lines.push('', `${GROUP_LABELS[bucket] ?? safeText(bucket)} (${ids.length})`);
      for (const id of ids) {
        const task = result.tasks.find((item) => item.id === id);
        if (task) lines.push(...taskLines(task));
      }
    }
  } else if (Array.isArray(result.created)) {
    lines = [`${result.dryRun ? 'Preview' : 'Intake'}: ${result.created.length} created, ${result.unchanged.length} unchanged`];
    for (const task of result.created) lines.push(...taskLines(task));
    for (const task of result.unchanged) lines.push(`Unchanged: ${task.id} (rev ${task.revision}, ${task.state})`);
  } else {
    lines = taskLines(result);
    if (command === 'ack-source') lines.unshift('Source variant recognized; task content unchanged.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** @param {string[]} args @returns {Promise<void>} */
export async function main(args = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true, tokens: true });
  } catch {
    invalid('Invalid command options. Run node next-actions.mjs --help.');
  }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) invalid(`Option --${token.name} must be supplied once.`);
    seen.add(token.name);
    if (typeof token.value === 'string' && (!token.value || token.value.startsWith('--'))) {
      invalid(`Option --${token.name} requires a value.`);
    }
  }
  const { values, positionals } = parsed;
  const [command, operand] = positionals;
  if (values.summary && values.json) invalid('Choose --summary or --json.');
  if (command && !Object.hasOwn(COMMAND_FLAGS, command)) invalid('Unknown command. Run node next-actions.mjs --help.');
  if (command) {
    const allowed = new Set([...COMMAND_FLAGS[command], 'help', 'summary', 'json']);
    if (Object.keys(values).some((key) => !allowed.has(key))) invalid('An option does not apply to this command.');
  }
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!command) invalid('A command is required. Run node next-actions.mjs --help.');
  const expectedOperands = command === 'list' || command === 'import' ? 1 : 2;
  if (positionals.length !== expectedOperands) invalid('Wrong number of command arguments. Run node next-actions.mjs --help.');
  const requireValue = (name) => {
    if (typeof values[name] !== 'string' || !values[name].trim()) invalid(`Option --${name} is required.`);
    return values[name];
  };
  // Parse and validate everything possible before any writer or lock is entered.
  let revision;
  let reason;
  if (REVIEW_FLAGS.every((flag) => COMMAND_FLAGS[command].includes(flag))) {
    const raw = requireValue('revision');
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) invalid('Revision must be a positive safe integer.');
    revision = Number(raw);
    reason = requireValue('reason');
  }
  const fileInput = COMMAND_FLAGS[command].includes('file') ? readJsonInput(requireValue('file')) : undefined;
  const context = createActionsContext();
  let result;
  if (command === 'list') {
    result = listActions(context, { includeClosed: values.all === true, timeZone: values['time-zone'] ?? 'UTC' });
  } else if (command === 'show') {
    result = readActions(context).tasks.find((task) => task.id === operand);
    if (!result) throw new ActionError('NOT_FOUND', 'Task not found.');
  } else if (command === 'import') {
    result = await importActions(context, fileInput, { dryRun: values['dry-run'] === true });
  } else if (command === 'add') {
    const proposal = {
      source: { namespace: 'manual', eventId: values.key ?? randomUUID(), actionKey: 'main' },
      title: operand, actor: values.actor ?? 'unknown',
      evidence: { text: requireValue('evidence'), ref: null },
      links: values.link ? [{ label: 'Action', ref: values.link }] : [],
    };
    result = await importActions(context, [proposal], { dryRun: values['dry-run'] === true });
  } else {
    result = await updateAction(context, operand, {
      operation: command, expectedRevision: revision, reason,
      ...(command === 'edit' ? { patch: fileInput } : {}),
      ...(command === 'ack-source' ? { proposal: fileInput } : {}),
      ...(command === 'bind' ? { trackerId: requireValue('tracker-id') } : {}),
    });
  }
  printResult(result, values.summary === true, command);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof ActionError ? error.code : 'IO';
    const message = error instanceof ActionError ? safeText(error.message) : 'Action command failed. No automatic recovery was attempted.';
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    process.exitCode = { NOT_FOUND: 2, CONFLICT: 3, LOCK_TIMEOUT: 4 }[code] ?? 1;
  });
}
