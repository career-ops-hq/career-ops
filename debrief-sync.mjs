#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendContact, VALID_TYPES } from './contact-extract.mjs';
import { replaceNextPin } from './followup-seed.mjs';
import { isRealCalendarDate } from './followup-cadence.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { parseMarkdownLinks, parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { acquireTrackerLock, resolveWorkspaceRoot, trackerLockDirFor, writeFileAtomic } from './tracker-utils.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const FENCE = /(##[ \t]*Machine Summary[ \t]*\n+```(?:yaml|yml)?[ \t]*\n)([\s\S]*?)(\n```)/i;

const KNOWN_FLAGS = ['--app', '--dealbreaker', '--contact-name', '--contact-email', '--contact-type', '--next', '--why', '--help', '-h'];
const VALUE_FLAGS = ['--app', '--dealbreaker', '--contact-name', '--contact-email', '--contact-type', '--next', '--why'];
const USAGE = `Usage:
  node debrief-sync.mjs --app N [--dealbreaker TEXT] [--contact-name NAME [--contact-email EMAIL] [--contact-type TYPE]]... [--next YYYY-MM-DD] [--why TEXT]

Records a confirmed interview debrief on one tracker row. Pass at least one of
--dealbreaker, --contact-name, or --next. A second run of the same command
changes nothing.`;

export class DebriefSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DebriefSyncError';
    this.code = code;
  }
}

function planError(code, message) {
  throw new DebriefSyncError(code, `${code}: ${message}`);
}

function insideWorkspace(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizeDealbreaker(value) {
  if (value == null) return null;
  const text = String(value);
  // Notes are joined with "; ". A semicolon, tab, or newline would split the
  // cell, so the same sentence would not match on the next run.
  if (/[\t\n\r;]/.test(text)) {
    planError('BAD_PLAN', 'dealbreaker text cannot contain a tab, newline, or semicolon');
  }
  const trimmed = text.trim();
  return trimmed || null;
}

function normalizeContacts(contacts) {
  if (contacts == null) return [];
  if (!Array.isArray(contacts)) planError('BAD_PLAN', 'contacts must be a list');
  return contacts.map((contact) => {
    const name = String(contact?.name ?? '').trim();
    if (!name || /[\t\r\n]/.test(String(contact?.name ?? ''))) {
      planError('BAD_PLAN', 'each contact needs a name without a tab or newline');
    }
    const next = { name };
    const email = contact?.email == null ? '' : String(contact.email).trim();
    if (email) next.email = email;
    const type = contact?.type == null ? '' : String(contact.type).trim();
    if (type) {
      if (!VALID_TYPES.has(type)) {
        planError('BAD_PLAN', `contact type must be one of ${[...VALID_TYPES].join(', ')}`);
      }
      next.type = type;
    }
    return next;
  });
}

function normalizeNext(value) {
  if (value == null || value === '') return null;
  if (!isRealCalendarDate(String(value))) {
    planError('AMBIGUOUS_DATE', `next date must be one real YYYY-MM-DD day, got ${value}`);
  }
  return String(value);
}

function normalizeWhy(value) {
  if (value == null) return null;
  const text = String(value);
  if (/[\t\r\n]/.test(text)) planError('BAD_PLAN', 'pin note cannot contain a tab or newline');
  const trimmed = text.trim();
  return trimmed || null;
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') planError('BAD_PLAN', 'plan must be an object');
  if (!Number.isSafeInteger(plan.appNum) || plan.appNum <= 0) {
    planError('BAD_PLAN', 'appNum must be a positive integer');
  }
  const dealbreaker = normalizeDealbreaker(plan.dealbreaker);
  const contacts = normalizeContacts(plan.contacts);
  const nextDate = normalizeNext(plan.nextDate);
  const nextWhy = nextDate ? normalizeWhy(plan.nextWhy) : null;
  if (dealbreaker == null && contacts.length === 0 && nextDate == null) {
    planError('BAD_PLAN', 'pass a dealbreaker, a contact, or a next date');
  }
  return { appNum: plan.appNum, dealbreaker, contacts, nextDate, nextWhy };
}

function replaceEntry(yamlBody, key, entry) {
  const lines = yamlBody.split('\n');
  const idx = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (idx === -1) return `${yamlBody}${yamlBody.endsWith('\n') ? '' : '\n'}${entry.join('\n')}`;
  let end = idx + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^(\s|-(\s|$))/.test(lines[end]))) end += 1;
  while (end > idx + 1 && lines[end - 1].trim() === '') end -= 1;
  lines.splice(idx, end - idx, ...entry);
  return lines.join('\n');
}

function hardStops(summary) {
  return Array.isArray(summary?.hard_stops) ? summary.hard_stops.map((item) => String(item)) : [];
}

function rewriteSummary(yamlBody, summary, sentence) {
  let next = yamlBody;
  if (String(summary.final_decision ?? '').trim() !== 'Skip') {
    next = replaceEntry(next, 'final_decision', ['final_decision: "Skip"']);
  }
  const stops = hardStops(summary);
  if (!stops.includes(sentence)) {
    const items = [...stops, sentence].map((item) => `  - ${JSON.stringify(item)}`);
    next = replaceEntry(next, 'hard_stops', ['hard_stops:', ...items]);
  }
  return next;
}

function parseSummary(yamlBody) {
  try {
    return loadYaml(yamlBody);
  } catch (err) {
    planError('BAD_PLAN', `Machine Summary YAML did not parse: ${err.message}`);
  }
}

function applyReport(report, sentence) {
  const fence = report.match(FENCE);
  if (!fence) planError('BAD_PLAN', 'the report has no Machine Summary YAML');
  const summary = parseSummary(fence[2]);
  if (summary == null || typeof summary !== 'object' || Array.isArray(summary)) {
    planError('BAD_PLAN', 'the Machine Summary YAML is not a mapping');
  }
  const nextYaml = rewriteSummary(fence[2], summary, sentence);
  const written = parseSummary(nextYaml);
  if (written?.final_decision !== 'Skip' || !hardStops(written).includes(sentence)) {
    planError('BAD_PLAN', 'the Machine Summary could not be rewritten safely; edit final_decision and hard_stops by hand');
  }
  return report.replace(fence[0], () => `${fence[1]}${nextYaml}${fence[3]}`);
}

function reportPathFor(row, workspaceRoot) {
  const links = parseMarkdownLinks(String(row.report ?? ''));
  if (links.length !== 1) {
    planError('BAD_PLAN', `application #${row.num} must link exactly one report`);
  }
  const normalized = links[0].target.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
  const candidate = resolve(normalized.includes('/') ? workspaceRoot : join(workspaceRoot, 'reports'), normalized);
  if (!insideWorkspace(workspaceRoot, candidate) || !existsSync(candidate)) {
    planError('BAD_PLAN', `report for application #${row.num} was not found`);
  }
  return candidate;
}

function loadRow(appsFile, appNum) {
  if (!existsSync(appsFile)) planError('BAD_PLAN', `tracker not found at ${appsFile}`);
  const lines = readFileSync(appsFile, 'utf8').split('\n');
  const colmap = resolveColumns(lines);
  const row = lines.map((line) => parseTrackerRow(line, colmap)).find((item) => item?.num === appNum);
  if (!row) planError('BAD_PLAN', `application #${appNum} is not in the tracker`);
  return row;
}

function appendDealbreakerNote(appNum, status, sentence, root, { dryRun = false } = {}) {
  const stdout = execFileSync(process.execPath, [
    join(CODE_ROOT, 'set-status.mjs'),
    '--row', String(appNum),
    status,
    '--note', `Dealbreaker: ${sentence}`,
    '--json',
    ...(dryRun ? ['--dry-run'] : []),
  ], {
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_ROOT: root },
    ...(dryRun ? { stdio: ['ignore', 'pipe', 'pipe'] } : {}),
  });
  return JSON.parse(stdout).changed === true;
}

function checkDealbreakerNote(appNum, status, sentence, root) {
  try {
    appendDealbreakerNote(appNum, status, sentence, root, { dryRun: true });
  } catch (err) {
    const detail = String(err.stderr || err.message).replace(/^❌\s*/, '').trim();
    planError('BAD_PLAN', `set-status.mjs would not add the tracker note: ${detail}`);
  }
}

export async function applyDebriefSync(plan) {
  const normalized = normalizePlan(plan);
  const root = getCareerOpsRoot();
  const appsFile = resolveTrackerPath(root);
  const lock = await acquireTrackerLock(trackerLockDirFor(appsFile), { tracker: appsFile });
  let prepared;
  let wrote = false;
  try {
    const row = loadRow(appsFile, normalized.appNum);
    const status = row.status.trim();
    const company = row.company.trim();
    if (normalized.contacts.length > 0 && !company) {
      planError('BAD_PLAN', 'the tracker row has no company to store with the contact');
    }
    if (normalized.dealbreaker && !status) {
      planError('BAD_PLAN', 'the tracker row has no status to keep while recording the dealbreaker');
    }
    if (normalized.dealbreaker) {
      const reportPath = reportPathFor(row, resolveWorkspaceRoot(appsFile));
      const original = readFileSync(reportPath, 'utf8');
      const next = applyReport(original, normalized.dealbreaker);
      checkDealbreakerNote(normalized.appNum, status, normalized.dealbreaker, root);
      if (next !== original) {
        writeFileAtomic(reportPath, next);
        wrote = true;
      }
    }
    prepared = { status, company };
  } finally {
    lock.release();
  }

  if (normalized.dealbreaker) {
    if (appendDealbreakerNote(normalized.appNum, prepared.status, normalized.dealbreaker, root)) wrote = true;
  }
  const contactsPath = join(root, 'data', 'contacts.tsv');
  for (const contact of normalized.contacts) {
    const before = existsSync(contactsPath) ? readFileSync(contactsPath, 'utf8') : null;
    const payload = {
      name: contact.name,
      company: prepared.company,
      tracker: String(normalized.appNum),
    };
    if (contact.email) payload.email = contact.email;
    if (contact.type) payload.type = contact.type;
    await appendContact(payload, contactsPath);
    const after = readFileSync(contactsPath, 'utf8');
    if (after !== before) wrote = true;
  }
  if (normalized.nextDate) {
    const pin = await replaceNextPin(normalized.appNum, {
      date: normalized.nextDate,
      why: normalized.nextWhy,
    });
    if (pin.changed) wrote = true;
  }
  return { wrote, appNum: normalized.appNum };
}

function flagToken(token) {
  const eq = token.indexOf('=');
  return eq === -1 ? token : token.slice(0, eq);
}

function parseArgs(args) {
  const plan = { appNum: null, dealbreaker: null, contacts: [], nextDate: null, nextWhy: null };
  const seen = new Set();
  let current = null;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--help' || token === '-h') continue;
    if (!token.startsWith('--')) planError('BAD_PLAN', `unexpected argument ${token}`);
    const flag = flagToken(token);
    const eq = token.indexOf('=');
    const value = eq === -1 ? args[i + 1] : token.slice(eq + 1);
    if (eq === -1) i += 1;
    if (flag === '--contact-name') {
      current = { name: value };
      plan.contacts.push(current);
      continue;
    }
    if (flag === '--contact-email' || flag === '--contact-type') {
      if (!current) planError('BAD_PLAN', `${flag} must follow a contact name`);
      current[flag === '--contact-email' ? 'email' : 'type'] = value;
      continue;
    }
    if (seen.has(flag)) planError('BAD_PLAN', `${flag} was given twice`);
    seen.add(flag);
    if (flag === '--app') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        planError('BAD_PLAN', `--app must be a positive integer, got ${value}`);
      }
      plan.appNum = Number(value);
    } else if (flag === '--dealbreaker') plan.dealbreaker = value;
    else if (flag === '--next') plan.nextDate = value;
    else if (flag === '--why') plan.nextWhy = value;
  }
  return plan;
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const result = await applyDebriefSync(parseArgs(args));
  console.log(JSON.stringify(result));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
