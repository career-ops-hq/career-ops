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
 * line format and its defaults. It depends on lib/ats-board-url.mjs only, so
 * CI can run the base branch's copy of it.
 * No network, no npm dependencies.
 */

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

