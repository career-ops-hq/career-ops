#!/usr/bin/env node
// @ts-check
/**
 * seeds/employers-import.mjs: turn a list of job board URLs into inbox files
 * for the employer registry (employers/inbox/, see employers/README.md).
 *
 *   node seeds/employers-import.mjs <list> --login <github-login> [--date YYYY-MM-DD]
 *                                   [--out employers/inbox] [--rejects <file>]
 *
 * <list> is a CSV file or plain text:
 *   - one board URL per line, optionally followed by ,name,website; or
 *   - a CSV whose header names a url column (url, careers_url or board_url) and
 *     optionally name (or company, employer) and website (or domain); other
 *     columns are ignored.
 * Blank lines and lines starting with # are skipped.
 *
 * Each URL is read back into the registry's coordinates (ats, region, board,
 * workday_host) by parseBoardUrl(), the reverse of the builders in
 * lib/ats-board-url.mjs. A URL is accepted only when building the board URL
 * from those coordinates and reading it again gives the same coordinates, so
 * what lands in the inbox is exactly the board the URL named, in its
 * canonical form. Job posting links, legacy hosts and locale prefixes are read
 * back to their board.
 *
 * The boards go to <out>/<date>-<login>.ndjson, or to -001.ndjson,
 * -002.ndjson, … when there are more than 5,000. A URL that is not a board on
 * a supported ATS, a duplicate, or a line with an invalid name or website
 * goes to the rejects file (default: <list>.rejected.csv) with the reason,
 * never to the inbox. With no name column, the name is made from the board id
 * (acme-robotics → Acme Robotics): check it before opening the pull request.
 *
 * No network: nothing is fetched or probed. Exit codes: 0 at least one board
 * written, 1 nothing to write, 2 usage error.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BOARD_ATS, REGIONAL_BOARD_URL_BUILDERS, buildBoardUrl } from '../lib/ats-board-url.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { INBOX_DIR, INBOX_MAX_LINES, parseInboxName } from './employers-inbox.mjs';
import {
  GITHUB_LOGIN_RE,
  boardIdentity,
  boardProblem,
  inboxLineProblems,
  loadAggregatorDomains,
  nameProblem,
  websiteProblem,
} from './employers-validate.mjs';

// ── URL → board ─────────────────────────────────────────────────────────

/** @typedef {{ats: string, region?: string, board: string, workday_host?: string}} BoardCoords */

const GREENHOUSE_HOSTS = Object.freeze({
  'job-boards.greenhouse.io': 'us',
  'boards.greenhouse.io': 'us',
  'job-boards.eu.greenhouse.io': 'eu',
  'boards.eu.greenhouse.io': 'eu',
});
const LEVER_HOSTS = Object.freeze({ 'jobs.lever.co': 'us', 'jobs.eu.lever.co': 'eu' });
/** ATS whose board is the first path segment on one fixed host. */
const PATH_HOSTS = Object.freeze({
  'jobs.ashbyhq.com': 'ashby',
  'apply.workable.com': 'workable',
  'careers.smartrecruiters.com': 'smartrecruiters',
  'jobs.smartrecruiters.com': 'smartrecruiters',
  'ats.rippling.com': 'rippling',
});
/** ATS whose board is the company's subdomain. */
const SUBDOMAIN_HOSTS = Object.freeze({
  'recruitee.com': 'recruitee',
  'breezy.hr': 'breezy',
  'bamboohr.com': 'bamboohr',
  'pinpointhq.com': 'pinpoint',
});
// The vendor's own subdomains: never a company board.
const VENDOR_SUBDOMAINS = new Set(['www', 'app', 'api', 'help', 'support', 'status', 'blog', 'docs', 'careers', 'jobs', 'developers', 'marketplace']);

const WORKDAY_JOBS_HOST_RE = /^([a-z0-9][a-z0-9_-]*)\.(wd[0-9]{1,3})\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST_RE = /^(wd[0-9]{1,3})\.myworkdaysite\.com$/;
// A locale prefix in a Workday path: en-US, fr-FR.
const WORKDAY_LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;

/**
 * The board a URL names, without checks: the raw reading of its host and path.
 * @param {URL} u
 * @returns {BoardCoords | {error: string}}
 */
function readCoords(u) {
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const segs = u.pathname.split('/').filter(Boolean);

  if (Object.hasOwn(GREENHOUSE_HOSTS, host)) {
    let board = segs[0];
    // Embedded boards name the board in ?for= (/embed/job_board?for=acme).
    if (!board || board === 'embed') board = u.searchParams.get('for') || '';
    if (!board) return { error: 'a Greenhouse URL without a board id' };
    return { ats: 'greenhouse', region: GREENHOUSE_HOSTS[/** @type {keyof typeof GREENHOUSE_HOSTS} */ (host)], board };
  }
  if (Object.hasOwn(LEVER_HOSTS, host)) {
    if (!segs[0]) return { error: 'a Lever URL without a board id' };
    return { ats: 'lever', region: LEVER_HOSTS[/** @type {keyof typeof LEVER_HOSTS} */ (host)], board: segs[0] };
  }
  if (Object.hasOwn(PATH_HOSTS, host)) {
    const ats = PATH_HOSTS[/** @type {keyof typeof PATH_HOSTS} */ (host)];
    if (!segs[0]) return { error: `a ${ats} URL without a board id` };
    if (ats === 'workable' && segs[0] === 'j') return { error: 'a Workable job link (/j/<code>) does not name the company; use apply.workable.com/<company>' };
    return { ats, board: segs[0] };
  }
  if (host === 'join.com' || host === 'www.join.com') {
    if (segs[0] !== 'companies' || !segs[1]) return { error: 'a JOIN board is join.com/companies/<company>' };
    return { ats: 'join', board: segs[1] };
  }
  for (const [suffix, ats] of Object.entries(SUBDOMAIN_HOSTS)) {
    if (host === suffix || !host.endsWith(`.${suffix}`)) continue;
    const label = host.slice(0, -(suffix.length + 1));
    if (label.includes('.')) return { error: `${host} is not a ${ats} board: the board is <company>.${suffix}` };
    if (VENDOR_SUBDOMAINS.has(label)) return { error: `${host} is ${ats}'s own site, not a company board` };
    return { ats, board: label };
  }
  const jobs = WORKDAY_JOBS_HOST_RE.exec(host);
  if (jobs) {
    const [, tenant, instance] = jobs;
    let rest = segs;
    // The CXS API path: /wday/cxs/<tenant>/<site>/jobs.
    if (rest[0] === 'wday' && rest[1] === 'cxs') rest = rest.slice(3);
    else if (rest[0] && WORKDAY_LOCALE_RE.test(rest[0]) && rest[1]) rest = rest.slice(1);
    if (!rest[0]) return { error: 'a Workday URL without a site (<tenant>.<wdN>.myworkdayjobs.com/<site>)' };
    return { ats: 'workday', board: `${tenant}/${instance}/${rest[0]}`, workday_host: 'jobs' };
  }
  const site = WORKDAY_SITE_HOST_RE.exec(host);
  if (site) {
    const [, instance] = site;
    let rest = segs;
    if (rest[0] && rest[0] !== 'recruiting' && WORKDAY_LOCALE_RE.test(rest[0])) rest = rest.slice(1);
    if (rest[0] !== 'recruiting' || !rest[1] || !rest[2]) return { error: 'a myworkdaysite.com board is <wdN>.myworkdaysite.com/recruiting/<tenant>/<site>' };
    return { ats: 'workday', board: `${rest[1].toLowerCase()}/${instance}/${rest[2]}`, workday_host: 'site' };
  }
  return { error: `${host} is not a board host of a supported ATS (${BOARD_ATS.join(', ')})` };
}

/**
 * Read a board URL back into registry coordinates: the reverse of
 * buildBoardUrl(). Accepts the canonical URL and the other forms that name the
 * same board (job posting links, legacy hosts, locale prefixes, http://, no
 * scheme). The answer is checked: the board id must be valid for its ATS, and
 * the canonical URL built from the coordinates must read back to the same
 * coordinates.
 * @param {unknown} raw
 * @returns {(BoardCoords & {careers_url: string}) | {error: string}}
 */
export function parseBoardUrl(raw) {
  let text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { error: 'no URL' };
  if (/\s/.test(text)) return { error: 'a URL has no spaces' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let u;
  try { u = new URL(text); } catch { return { error: 'not a URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: `${u.protocol} is not a web URL` };
  if (u.username || u.password) return { error: 'a URL with a user name or password' };
  if (u.port) return { error: 'a URL with a port is not a board URL' };
  const coords = readCoords(u);
  if ('error' in coords) return coords;
  const problem = boardProblem(coords.ats, coords.board);
  if (problem) return { error: problem };
  const careers = buildBoardUrl(coords);
  if (!careers) return { error: `${coords.ats} board ${JSON.stringify(coords.board)} does not build a board URL` };
  const again = readCoords(new URL(careers));
  if (!isDeepStrictEqual(again, coords)) return { error: `the canonical URL ${careers} does not read back to the same board` };
  return { ...coords, careers_url: careers };
}

// ── The list ────────────────────────────────────────────────────────────

/**
 * Parse CSV text (RFC 4180: quoted fields, "" inside quotes, CRLF or LF).
 * @param {string} text
 * @returns {Array<{line: number, cells: string[]}>}  one record per row, with the line it starts on
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  /** @type {Array<{line: number, cells: string[]}>} */
  const out = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false;
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell === '') { quoted = true; any = true; } else if (c === ',') { cells.push(cell); cell = ''; any = true; } else if (c === '\r' && src[i + 1] === '\n') { /* the \n ends the row */ } else if (c === '\n') {
      cells.push(cell);
      if (any || cell !== '') out.push({ line: start, cells });
      cells = []; cell = ''; any = false; line++; start = line;
    } else { cell += c; any = true; }
  }
  if (any || cell !== '') { cells.push(cell); out.push({ line: start, cells }); }
  return out;
}

const URL_HEADERS = ['url', 'careers_url', 'board_url', 'careers url', 'board url'];
const NAME_HEADERS = ['name', 'company', 'company_name', 'company name', 'employer'];
const WEBSITE_HEADERS = ['website', 'domain', 'company_website', 'web'];

/**
 * The entries of a list: the URL, and the name and website when given.
 * @param {string} text
 * @returns {{entries: Array<{line: number, url: string, name: string, website: string}>, header: boolean, ignoredColumns: string[]}}
 */
export function readList(text) {
  const records = parseCsv(text).filter((r) => {
    const first = (r.cells[0] || '').trim();
    return r.cells.some((c) => c.trim()) && !first.startsWith('#');
  });
  let cols = { url: 0, name: 1, website: 2 };
  let header = false;
  /** @type {string[]} */
  let ignoredColumns = [];
  if (records.length) {
    const head = records[0].cells.map((c) => c.trim().toLowerCase());
    const urlCol = head.findIndex((h) => URL_HEADERS.includes(h));
    if (urlCol !== -1) {
      header = true;
      cols = { url: urlCol, name: head.findIndex((h) => NAME_HEADERS.includes(h)), website: head.findIndex((h) => WEBSITE_HEADERS.includes(h)) };
      ignoredColumns = records[0].cells.filter((_, i) => i !== cols.url && i !== cols.name && i !== cols.website).map((c) => c.trim()).filter(Boolean);
      records.shift();
    }
  }
  const cell = (/** @type {string[]} */ cells, /** @type {number} */ i) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
  return {
    entries: records.map((r) => ({ line: r.line, url: cell(r.cells, cols.url), name: cell(r.cells, cols.name), website: cell(r.cells, cols.website) })),
    header,
    ignoredColumns,
  };
}

/**
 * A name made from the board id, for a list without names: acme-robotics →
 * Acme Robotics; a Workday board uses its tenant. Mixed case is kept (DeepL).
 * @param {BoardCoords} coords
 */
export function nameFromBoard(coords) {
  const id = coords.ats === 'workday' ? coords.board.split('/')[0] : coords.board;
  return id.split(/[-_.]+/).filter(Boolean)
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * A website cell as the registry wants it: the bare domain, lowercase, without
 * scheme, www, port or path. Empty stays empty.
 * @param {string} value
 */
export function normalizeWebsite(value) {
  let v = value.trim().toLowerCase();
  if (!v) return '';
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (v.startsWith('www.')) v = v.slice(4);
  return v;
}

/**
 * The inbox line for one board, keys in the inbox order, every default
 * written out.
 * @param {BoardCoords} coords
 * @param {string} name
 * @param {string} website
 */
function inboxLine(coords, name, website) {
  /** @type {any} */
  const line = { ats: coords.ats };
  if (Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, coords.ats)) line.region = coords.region;
  line.board = coords.board;
  if (coords.ats === 'workday') line.workday_host = coords.workday_host;
  line.name = name;
  if (website) line.website = website;
  return line;
}

/**
 * Import a list: the inbox lines it gives and the entries it rejects.
 * @param {string} text
 * @param {{aggregatorDomains?: Set<string>}} [opts]
 */
export function importList(text, { aggregatorDomains = loadAggregatorDomains() } = {}) {
  const { entries, header, ignoredColumns } = readList(text);
  /** @type {any[]} */
  const lines = [];
  /** @type {Array<{line: number, input: string, reason: string}>} */
  const rejected = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  let derivedNames = 0;
  let rewritten = 0;
  for (const e of entries) {
    const reject = (/** @type {string} */ reason) => rejected.push({ line: e.line, input: e.url, reason });
    const parsed = parseBoardUrl(e.url);
    if ('error' in parsed) { reject(parsed.error); continue; }
    const { careers_url: careersUrl, ...coords } = parsed;
    const identity = boardIdentity({ ...coords, careers_url: careersUrl });
    const first = seen.get(identity);
    if (first !== undefined) { reject(`the same board as line ${first}`); continue; }
    let name = e.name;
    if (!name) { name = nameFromBoard(coords); derivedNames++; }
    const nameIssue = nameProblem(name);
    if (nameIssue) { reject(nameIssue); continue; }
    const website = normalizeWebsite(e.website);
    if (website) {
      const issue = websiteProblem(website);
      if (issue) { reject(issue); continue; }
    }
    const line = inboxLine(coords, name, website);
    const problems = inboxLineProblems(line, aggregatorDomains);
    if (problems.length) { reject(problems.join('; ')); continue; }
    seen.set(identity, e.line);
    if (careersUrl !== e.url.trim()) rewritten++;
    lines.push(line);
  }
  return { lines, rejected, read: entries.length, header, ignoredColumns, derivedNames, rewritten };
}

/**
 * Split lines into inbox files: one file when they fit, else -001, -002, …
 * @param {any[]} lines
 * @param {string} id  <date>-<login>
 * @returns {Array<{name: string, lines: any[]}>}
 */
export function chunkInbox(lines, id, max = INBOX_MAX_LINES) {
  if (lines.length <= max) return lines.length ? [{ name: `${id}.ndjson`, lines }] : [];
  const out = [];
  for (let i = 0; i * max < lines.length; i++) {
    out.push({ name: `${id}-${String(i + 1).padStart(3, '0')}.ndjson`, lines: lines.slice(i * max, (i + 1) * max) });
  }
  if (out.length > 999) throw new Error(`${lines.length} boards need more than 999 files; split the list`);
  return out;
}

/** @param {string} v */
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// ── CLI ─────────────────────────────────────────────────────────────────

const USAGE = `Usage: node seeds/employers-import.mjs <list> --login <github-login> [--date YYYY-MM-DD]
                                       [--out ${INBOX_DIR}] [--rejects <file>]

  <list>       a CSV or text file: one board URL per line (optionally ,name,website),
               or a CSV with a header naming url, and optionally name and website.
  --login      your GitHub username: the account that opens the pull request.
  --date       the contribution date (default: today, UTC).
  --out        where to write the inbox files (default: ${INBOX_DIR}).
  --rejects    where to write the lines that were not imported, with the reason
               (default: <list>.rejected.csv).
  --help       show this text.

No network: nothing is fetched. Run the validator afterwards:
  node seeds/employers-validate.mjs`;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{input: string|null, login: string|null, date: string|null, out: string, rejects: string|null, help: boolean}} */
  const opts = { input: null, login: null, date: null, out: INBOX_DIR, rejects: null, help: false };
  const value = (/** @type {number} */ i, /** @type {string} */ flag) => {
    const v = argv[i];
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const [flag, inline] = a.startsWith('--') && eq !== -1 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, null];
    const take = () => (inline !== null ? inline : value(++i, flag));
    if (flag === '--help' || flag === '-h') opts.help = true;
    else if (flag === '--login') opts.login = take();
    else if (flag === '--date') opts.date = take();
    else if (flag === '--out') opts.out = take();
    else if (flag === '--rejects') opts.rejects = take();
    else if (a.startsWith('-')) throw new Error(`unknown argument: ${a}`);
    else if (opts.input === null) opts.input = a;
    else throw new Error(`one list at a time; got ${opts.input} and ${a}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(USAGE); return; }
    if (!opts.input) throw new Error('give the list to import');
    if (!opts.login) throw new Error('--login is required: the GitHub username that opens the pull request');
    if (!GITHUB_LOGIN_RE.test(opts.login)) throw new Error(`--login ${JSON.stringify(opts.login)} is not a GitHub username`);
    opts.date ??= new Date().toISOString().slice(0, 10);
  } catch (e) {
    console.error(`employers-import: ${/** @type {Error} */ (e).message}\n\n${USAGE}`);
    process.exit(2);
  }
  const id = `${opts.date}-${opts.login.toLowerCase()}`;
  const named = parseInboxName(`${id}.ndjson`);
  if ('error' in named) {
    console.error(`employers-import: ${named.error}`);
    process.exit(2);
  }
  const input = resolve(opts.input);
  if (!existsSync(input)) {
    console.error(`employers-import: ${opts.input} does not exist`);
    process.exit(2);
  }
  const outDir = resolve(opts.out);
  if (existsSync(outDir)) {
    const clash = readdirSync(outDir).filter((f) => { const p = parseInboxName(f); return !('error' in p) && p.id === id; });
    if (clash.length) {
      console.error(`employers-import: ${opts.out} already has files for ${id} (${clash.join(', ')}); move them away or use another --date`);
      process.exit(2);
    }
  }

  const result = importList(readFileSync(input, 'utf8'));
  let chunks;
  try {
    chunks = chunkInbox(result.lines, id);
  } catch (e) {
    console.error(`employers-import: ${/** @type {Error} */ (e).message}`);
    process.exit(2);
  }
  if (chunks.length) mkdirSync(outDir, { recursive: true });
  for (const c of chunks) writeFileSync(join(outDir, c.name), `${c.lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

  const rejectsPath = resolve(opts.rejects || join(dirname(input), `${basename(input)}.rejected.csv`));
  if (result.rejected.length) {
    writeFileSync(rejectsPath, `line,input,reason\n${result.rejected.map((r) => [String(r.line), r.input, r.reason].map(csvCell).join(',')).join('\n')}\n`);
  }

  console.log(`read ${result.read} line(s)${result.header ? ' (CSV with a header)' : ''}`);
  if (result.ignoredColumns.length) console.log(`ignored columns: ${result.ignoredColumns.join(', ')}`);
  console.log(`wrote ${result.lines.length} board(s) in ${chunks.length} file(s):`);
  for (const c of chunks) console.log(`  ${join(opts.out, c.name)} (${c.lines.length})`);
  if (result.rewritten) console.log(`${result.rewritten} URL(s) were written as their board's canonical URL`);
  if (result.derivedNames) console.log(`${result.derivedNames} name(s) were made from the board id: check them before you open the pull request`);
  if (result.rejected.length) console.log(`rejected ${result.rejected.length} line(s), with the reason, in ${rejectsPath}`);
  if (!chunks.length) {
    console.error('employers-import: no board to write');
    process.exit(1);
  }
  console.log('next: node seeds/employers-validate.mjs, then open a pull request that adds only these files');
}

if (isMainModule(import.meta.url)) main();
