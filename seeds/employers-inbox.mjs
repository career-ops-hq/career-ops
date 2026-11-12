// @ts-check
/**
 * seeds/employers-inbox.mjs: the contribution inbox of the employer registry,
 * employers/inbox/. A contribution is one new file there, and nothing else:
 *
 *   employers/inbox/<YYYY-MM-DD>-<github-login>[-NNN].ndjson   up to 5,000 boards
 *   employers/inbox/<YYYY-MM-DD>-<github-login>.json           optional: an organization's
 *                                                               contribution manifest
 *
 * Each line of an .ndjson file is one board, in the short form a contributor
 * can write by hand:
 *
 *   {"ats":"greenhouse","board":"vercel","name":"Vercel","website":"vercel.com"}
 *
 * Maintainers fold the inbox into boards/ and contributions/
 * (seeds/employers-fold.mjs); the validator checks it in every pull request.
 *
 * This module holds what does not need the validator: the file names, the
 * line format and its defaults, and the recognition of a pull request that
 * only adds inbox files (classifyInboxDiff, recognizeInboxOnly). It depends on
 * lib/ats-board-url.mjs only, so CI can run the base branch's copy of it.
 * No network, no npm dependencies.
 */

import { spawnSync } from 'node:child_process';
import { BOARD_ATS, REGIONAL_BOARD_URL_BUILDERS, buildBoardUrl } from '../lib/ats-board-url.mjs';

/** The inbox, relative to the checkout root. */
export const INBOX_DIR = 'employers/inbox';

/** Lines per inbox file. A longer list is split into -001, -002, … files. */
export const INBOX_MAX_LINES = 5000;

/** The keys an inbox line may have, in the order the importer writes them. */
export const INBOX_LINE_KEYS = Object.freeze(['ats', 'region', 'board', 'workday_host', 'name', 'website']);
export const INBOX_LINE_REQUIRED = Object.freeze(['ats', 'board', 'name']);

/**
 * What an inbox line leaves out. Greenhouse and Lever boards are on the US
 * host unless the line says `"region":"eu"`; a Workday board is on the
 * <tenant>.<wdN>.myworkdayjobs.com host unless it says `"workday_host":"site"`.
 */
export const DEFAULT_REGION = 'us';
export const DEFAULT_WORKDAY_HOST = 'jobs';

// A GitHub login, lowercase. GitHub logins are case-insensitive, and the file
// name becomes a contribution id, which is lowercase. LOGIN_LAZY lets a
// trailing -NNN be read as the part number: "2026-11-20-acme-002.ndjson" is
// part 2 from acme. (A login that itself ends in -NNN writes its part number
// every time: <date>-<login>-001.ndjson.)
const LOGIN = '[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}';
const LOGIN_LAZY = '[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}?';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
export const INBOX_BOARDS_FILE_RE = new RegExp(`^(${DATE})-(${LOGIN_LAZY})(?:-(\\d{3}))?\\.ndjson$`);
export const INBOX_SHEET_FILE_RE = new RegExp(`^(${DATE})-(${LOGIN})\\.json$`);

/** @param {string} value */
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * @typedef {{kind: 'boards'|'sheet', date: string, login: string, part: number|null, id: string}} InboxName
 */

/**
 * Read an inbox file name. `id` is the contribution the file belongs to,
 * <YYYY-MM-DD>-<login>: every part of one list and its manifest share it.
 * @param {string} name  the base name, without a directory
 * @returns {InboxName | {error: string}}
 */
export function parseInboxName(name) {
  const how = 'inbox files are named <YYYY-MM-DD>-<github-login>.ndjson (or -001.ndjson, -002.ndjson, … for a longer list), and an optional manifest <YYYY-MM-DD>-<github-login>.json';
  if (typeof name !== 'string' || name.includes('/')) return { error: how };
  if (name !== name.toLowerCase() && (INBOX_BOARDS_FILE_RE.test(name.toLowerCase()) || INBOX_SHEET_FILE_RE.test(name.toLowerCase()))) {
    return { error: `${how}; write the login in lowercase: ${name.toLowerCase()}` };
  }
  const b = INBOX_BOARDS_FILE_RE.exec(name);
  const s = b ? null : INBOX_SHEET_FILE_RE.exec(name);
  const m = b || s;
  if (!m) return { error: how };
  const [, date, login, part] = m;
  if (!isCalendarDate(date)) return { error: `${date} is not a YYYY-MM-DD calendar date` };
  if (part === '000') return { error: 'part numbers start at 001' };
  return { kind: b ? 'boards' : 'sheet', date, login, part: part ? Number(part) : null, id: `${date}-${login}` };
}

/**
 * The board an inbox line points at, with the defaults filled in: the
 * coordinates buildBoardUrl() reads.
 * @param {any} line
 * @returns {{ats: string, region?: string, board: string, workday_host?: string}}
 */
export function inboxCoords(line) {
  /** @type {any} */
  const out = { ats: line.ats };
  if (Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, line.ats)) out.region = line.region ?? DEFAULT_REGION;
  else if (line.region !== undefined) out.region = line.region;
  out.board = line.board;
  if (line.ats === 'workday') out.workday_host = line.workday_host ?? DEFAULT_WORKDAY_HOST;
  else if (line.workday_host !== undefined) out.workday_host = line.workday_host;
  return out;
}

/**
 * The careers URL of an inbox line, or null when its coordinates build none.
 * @param {any} line
 */
export function inboxCareersUrl(line) {
  if (!line || typeof line !== 'object' || !BOARD_ATS.includes(line.ats)) return null;
  return buildBoardUrl(inboxCoords(line));
}

/**
 * The full registry row for an inbox line (keys in the registry's order).
 * @param {any} line  a line the validator accepts
 * @param {{source: string, contribution: string, added: string}} provenance
 */
export function inboxLineToRow(line, { source, contribution, added }) {
  const c = inboxCoords(line);
  /** @type {any} */
  const row = { ats: c.ats };
  if (c.region !== undefined) row.region = c.region;
  row.board = c.board;
  if (c.workday_host !== undefined) row.workday_host = c.workday_host;
  row.careers_url = buildBoardUrl(c);
  row.name = line.name;
  if (line.website !== undefined) row.website = line.website;
  row.source = source;
  row.contribution = contribution;
  row.added = added;
  return row;
}

// ── A pull request that only adds inbox files ───────────────────────────

/**
 * @typedef {{status: string, path: string, oldPath?: string, mode?: string}} DiffEntry
 * @typedef {{inboxOnly: boolean, files: string[], rejected: Array<{path: string, status: string, reason: string}>, logins: string[]}} InboxOnlyResult
 */

/** A regular, non-executable file in git. */
const REGULAR_FILE_MODE = '100644';

/**
 * Whether every change in a diff adds a new, validly named file directly under
 * employers/inbox/. Status A only: a modified (M), deleted (D), renamed (R),
 * copied (C) or retyped (T) file, or one added anywhere else, makes the answer
 * false and is listed in `rejected` with the reason. An empty diff is not an
 * inbox-only change.
 *
 * It looks at names and statuses, not at what the files hold: the validator
 * judges the content.
 *
 * @param {DiffEntry[]} entries
 * @returns {InboxOnlyResult}
 */
export function classifyInboxDiff(entries) {
  /** @type {string[]} */
  const files = [];
  /** @type {InboxOnlyResult['rejected']} */
  const rejected = [];
  const logins = new Set();
  const prefix = `${INBOX_DIR}/`;
  for (const e of entries) {
    const status = String(e.status || '').charAt(0);
    const path = String(e.path || '');
    const reject = (/** @type {string} */ reason) => rejected.push({ path, status: String(e.status || ''), reason });
    if (status !== 'A') {
      const what = { M: 'modifies', D: 'deletes', R: 'renames', C: 'copies', T: 'changes the type of' }[status] || 'changes';
      reject(`${what} a file; an inbox contribution only adds new files`);
      continue;
    }
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) {
      reject(`adds a file outside ${INBOX_DIR}/`);
      continue;
    }
    if (e.mode !== undefined && e.mode !== REGULAR_FILE_MODE) {
      reject(`file mode ${e.mode}; inbox files are regular files (${REGULAR_FILE_MODE})`);
      continue;
    }
    const parsed = parseInboxName(path.slice(prefix.length));
    if ('error' in parsed) {
      reject(parsed.error);
      continue;
    }
    files.push(path);
    logins.add(parsed.login);
  }
  return {
    inboxOnly: entries.length > 0 && rejected.length === 0,
    files: files.sort(),
    rejected,
    logins: [...logins].sort(),
  };
}

/**
 * Parse `git diff --raw -z` output into diff entries.
 * Each record is ":<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0",
 * with a second path for renames and copies (old, then new).
 * @param {string} text
 * @returns {DiffEntry[]}
 */
export function parseRawDiff(text) {
  const parts = text.split('\0');
  /** @type {DiffEntry[]} */
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i];
    if (!head) continue;
    if (!head.startsWith(':')) throw new Error(`unexpected git diff output: ${JSON.stringify(head.slice(0, 80))}`);
    const fields = head.slice(1).split(' ');
    const mode = fields[1];
    const status = fields[4] || '';
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[++i];
      const path = parts[++i];
      out.push({ status, path, oldPath, mode });
    } else {
      out.push({ status, path: parts[++i], mode });
    }
  }
  return out;
}

/**
 * The changes from `base` to `head`, as `git diff base...head` sees them
 * (what head adds since it branched off base), renames detected.
 * @param {{base: string, head?: string, cwd?: string}} opts
 * @returns {DiffEntry[]}
 */
export function gitDiffEntries({ base, head = 'HEAD', cwd = process.cwd() }) {
  for (const ref of [base, head]) {
    if (typeof ref !== 'string' || !ref || ref.startsWith('-')) throw new Error(`not a git ref: ${JSON.stringify(ref)}`);
  }
  const r = spawnSync('git', ['diff', '--raw', '-z', '--find-renames', '--no-color', '--no-ext-diff', `${base}...${head}`, '--'], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git diff ${base}...${head} failed: ${(r.stderr || '').trim()}`);
  return parseRawDiff(r.stdout);
}

/**
 * Whether the diff base...head only adds inbox files.
 * @param {{base: string, head?: string, cwd?: string}} opts
 * @returns {InboxOnlyResult & {base: string, head: string}}
 */
export function recognizeInboxOnly({ base, head = 'HEAD', cwd = process.cwd() }) {
  return { base, head, ...classifyInboxDiff(gitDiffEntries({ base, head, cwd })) };
}

/**
 * The markdown block for GITHUB_STEP_SUMMARY.
 * @param {InboxOnlyResult} r
 */
export function renderInboxOnlySummary(r) {
  const lines = ['## Inbox-only check', ''];
  if (r.inboxOnly) {
    lines.push(`**Yes**: this pull request only adds ${r.files.length} file${r.files.length === 1 ? '' : 's'} to \`${INBOX_DIR}/\`.`, '');
    for (const f of r.files) lines.push(`- \`${f}\``);
  } else if (r.rejected.length === 0) {
    lines.push('**No**: the pull request changes no file.');
  } else {
    lines.push(`**No**: ${r.rejected.length} change${r.rejected.length === 1 ? '' : 's'} outside the inbox-only path.`, '');
    for (const x of r.rejected.slice(0, 50)) lines.push(`- \`${x.path.replace(/[`\r\n]/g, '?')}\` (${x.status}): ${x.reason}`);
    if (r.rejected.length > 50) lines.push(`- ${r.rejected.length - 50} more in the job log.`);
  }
  return `${lines.join('\n')}\n`;
}
