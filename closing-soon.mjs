#!/usr/bin/env node
/**
 * closing-soon.mjs — surface tracker rows whose posting is about to close
 *
 * A posting's closing date has no structured home in the tracker, so people who
 * evaluate first and apply later type it into the free-text Notes cell
 * ("closes 2026-10-22", "deadline Nov 4"). This script reads those notes (and,
 * when a row's Notes carry no closing marker at all, the archived `jds/`
 * capture that `jd-capture.mjs` resolves by report number) and lists the rows
 * that close within N days, soonest first. Rows whose date has already passed
 * go in a separate `overdue` group; rows where a closing marker was found but
 * no date could be read go in `unparsed`, so nothing is silently dropped.
 *
 * Zero LLM, read-only: nothing is ever written to the tracker or any other
 * file, and no tracker column or schema is involved (issue #5412).
 *
 * Recognized dates, each introduced by `closes`, `closing date`, `closing`,
 * `deadline` or `apply by` (optionally followed by `:`, `on`, `by`, `is` and a
 * weekday name):
 *   - ISO              2026-10-22
 *   - Mon D, YYYY      Oct 22, 2026   (month names or 3-letter abbreviations)
 *   - Mon D            Oct 22         (this year, or next year when the date
 *                                      passed more than ROLLOVER_GRACE_DAYS ago)
 *   - MM/DD/YYYY       10/22/2026     (only when unambiguous: the second part
 *                                      is above 12, or both parts are equal)
 * Anything else after a marker (04/05/2026, 4 Nov 2026, "TBD") is reported as
 * `unparsed` rather than guessed.
 *
 * Run: node closing-soon.mjs                        (JSON to stdout)
 *      node closing-soon.mjs --summary              (human-readable table)
 *      node closing-soon.mjs --within 14            (window in days, default 7)
 *      node closing-soon.mjs --status Evaluated,Applied
 *      node closing-soon.mjs --today 2026-10-17     (deterministic runs/tests)
 *      node closing-soon.mjs --tracker path/to/applications.md --jds path/to/jds
 *      node closing-soon.mjs --clashes              (interview days with closings piling up)
 *      node closing-soon.mjs --clashes --clash-min 3 --interviews path/to/active-interviews.md
 *
 * --clashes is opt-in: it reads data/active-interviews.md (leading YYYY-MM-DD of
 * the Date/Time cell; rows in a terminal Status are skipped) and, for each
 * interview date inside the window, counts the closing-soon rows that close on
 * that day or the day before. At --clash-min (default 2) or more it adds a
 * `clashes` group. Without the flag the output is unchanged.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';

import { resolveColumns, parseTrackerRow, linkedReportNumbers } from './tracker-parse.mjs';
import { findCaptureForReport, captureSlug } from './jd-capture.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { localToday } from './lib/local-today.mjs';
import { parseDate } from './lib/parse-date.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { parseActiveInterviews, findColumn } from './process-quality.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');

export const DEFAULT_WITHIN_DAYS = 7;
export const DEFAULT_STATUS = 'Evaluated';
export const DEFAULT_CLASH_MIN = 2;

/** Interview Status values that no longer hold a date (emoji prefixes tolerated). */
const TERMINAL_INTERVIEW_RE = /\b(?:rejected|declined|ghosted|done)\b/i;

/**
 * A `Mon D` date (no year) that already passed by more than this many days is
 * read as next year's occurrence ("closes Jan 5" typed in December). Inside the
 * grace it stays this year and shows up as overdue.
 */
export const ROLLOVER_GRACE_DAYS = 60;

/** Largest capture read into memory; a JD longer than this is not a note. */
const MAX_CAPTURE_BYTES = 256 * 1024;
const READABLE_CAPTURE_EXTS = new Set(['.md', '.txt', '.html', '.htm']);

const MS_PER_DAY = 86_400_000;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// `closing date` is listed before `closing` so the longer form wins at the same
// position; `closed` is deliberately not a marker (it states a past fact, with
// no date a reader could act on).
const MARKER_RE = /\b(closes|closing\s+date|closing|deadline|apply\s+by)\b/gi;
const LEAD_IN_RE = new RegExp(
  '^\\s*[:=\\-\u2013\u2014]?\\s*(?:(?:on|by|is|at)\\s+)?'
  + '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+)?',
  'i',
);
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?![\d-])/;
const MON_D_Y_RE = new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})(?!\\d)`, 'i');
const MON_D_RE = new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d/])(?!\\s*,?\\s*\\d{3,})`, 'i');
const NUMERIC_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/;
const DATEISH_RE = new RegExp(`^(?:\\d|${MONTH_RE}\\b)`, 'i');

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => d.toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

/** Calendar-valid UTC date for y/m/d, or null (2026-02-31, Feb 29 off-leap). */
function makeDate(y, m, d) {
  return parseDate(`${y}-${pad(m)}-${pad(d)}`);
}

/**
 * Read one date off the front of `tail` (the text just after a marker).
 *
 * @returns {{date: Date, form: string, length: number}|{unparsed: string}|null}
 *   null when the tail does not look like a date at all.
 */
function readDate(tail, today) {
  let m = ISO_RE.exec(tail);
  if (m) {
    const date = makeDate(m[1], m[2], m[3]);
    return date ? { date, form: 'iso' } : { unparsed: 'invalid calendar date' };
  }

  m = MON_D_Y_RE.exec(tail);
  if (m) {
    const date = makeDate(m[3], MONTHS[m[1].toLowerCase()], m[2]);
    return date ? { date, form: 'mon-d-yyyy' } : { unparsed: 'invalid calendar date' };
  }

  m = NUMERIC_RE.exec(tail);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // MM/DD/YYYY is only unambiguous when it cannot also be DD/MM/YYYY.
    if (a < 1 || a > 12 || b < 1 || b > 31) return { unparsed: 'not a valid MM/DD/YYYY date' };
    if (b <= 12 && a !== b) return { unparsed: 'ambiguous MM/DD vs DD/MM' };
    const date = makeDate(m[3], a, b);
    return date ? { date, form: 'mm-dd-yyyy' } : { unparsed: 'invalid calendar date' };
  }

  m = MON_D_RE.exec(tail);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = today.getUTCFullYear();
    let date = makeDate(year, month, day);
    if (!date) return { unparsed: 'invalid calendar date' };
    if (daysBetween(date, today) > ROLLOVER_GRACE_DAYS) {
      date = makeDate(year + 1, month, day);
      if (!date) return { unparsed: 'invalid calendar date' };
    }
    return { date, form: 'mon-d' };
  }

  return DATEISH_RE.test(tail) ? { unparsed: 'unrecognized date format' } : null;
}

/**
 * Find closing-date markers in free text and read the date after each.
 *
 * @param {string} text
 * @param {Date} today - UTC-midnight "today"; only used to place `Mon D`.
 * @returns {{dates: {date: string, form: string, marker: string}[],
 *            unparsed: {marker: string, text: string, reason: string}[]}}
 *   `dates` are in text order. A bare `closing` with no date-shaped text after
 *   it is not a marker ("closing the loop"); every other marker without a
 *   readable date is returned in `unparsed`.
 */
export function extractClosingDates(text, today, { strictMarkers = true } = {}) {
  const dates = [];
  const unparsed = [];
  const source = String(text ?? '').replace(/\s+/g, ' ');
  MARKER_RE.lastIndex = 0;
  let match;
  while ((match = MARKER_RE.exec(source)) !== null) {
    const marker = match[1].toLowerCase().replace(/\s+/g, ' ');
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const tail = after.replace(LEAD_IN_RE, '');
    const read = readDate(tail, today);

    if (read && read.date) {
      dates.push({ date: isoDay(read.date), form: read.form, marker });
    } else if (read && read.unparsed) {
      unparsed.push({ marker, text: `${match[0]}${after}`.slice(0, 48).trim(), reason: read.unparsed });
    } else if (strictMarkers && marker !== 'closing') {
      unparsed.push({ marker, text: `${match[0]}${after}`.slice(0, 48).trim(), reason: 'no date after marker' });
    }
  }
  return { dates, unparsed };
}

/** Canonical states from templates/states.yml, as lookups to the label. */
export function loadStateLookup(statesFile = STATES_FILE) {
  const doc = loadYaml(readFileSync(statesFile, 'utf-8')) || {};
  const lookup = new Map();
  for (const s of doc.states || []) {
    const label = String(s.label);
    for (const key of [s.id, s.label, ...(s.aliases || [])]) {
      lookup.set(String(key).trim().toLowerCase(), label);
    }
  }
  return lookup;
}

/** `Evaluated, applied` -> Set{'Evaluated','Applied'}; throws on an unknown state. */
export function resolveStatusFilter(value, lookup = loadStateLookup()) {
  const labels = new Set();
  for (const part of String(value).split(',')) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const label = lookup.get(key);
    if (!label) {
      throw new Error(`Unknown status "${part.trim()}". Canonical states: ${[...new Set(lookup.values())].join(', ')}.`);
    }
    labels.add(label);
  }
  if (labels.size === 0) throw new Error('--status needs at least one state.');
  return labels;
}

/** A tag longer than this is treated as plain text, which bounds the scan. */
const MAX_TAG_CHARS = 4096;

/**
 * Index just past the '>' that ends the tag opening at html[start], skipping
 * quoted attribute values, or -1 when it does not close within MAX_TAG_CHARS.
 */
function tagEnd(html, start) {
  const limit = Math.min(html.length, start + MAX_TAG_CHARS);
  let quote = '';
  for (let i = start + 1; i < limit; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Flatten HTML to plain text for date matching only (never rendered): comments
 * and script/style blocks are dropped, tags (including quoted attribute values)
 * become spaces, and the few entities that matter are decoded. A single linear
 * pass, so hostile markup cannot trigger regex backtracking; best-effort, not
 * an HTML parser.
 */
export function htmlToText(html) {
  const lower = html.toLowerCase();
  const missing = new Set(); // closers already searched for and absent: never search again
  const indexOfOnce = (needle, from) => {
    if (missing.has(needle)) return -1;
    const at = lower.indexOf(needle, from);
    if (at === -1) missing.add(needle);
    return at;
  };
  // Closer of a script/style block: `</script` must end at a tag-name boundary,
  // so `</scripture>` does not close it.
  const rawClose = (name, from) => {
    const needle = '</' + name;
    let at = indexOfOnce(needle, from);
    while (at !== -1 && !/[\s/>]/.test(lower[at + needle.length] ?? '')) {
      at = lower.indexOf(needle, at + 1);
    }
    if (at === -1) missing.add(needle);
    return at;
  };
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    i = lt;
    let end = -1;
    if (lower.startsWith('<!--', lt)) {
      const close = indexOfOnce('-->', lt + 4);
      if (close !== -1) end = close + 3;
    } else {
      const raw = /^<(script|style)(?![a-z0-9])/.exec(lower.slice(lt, lt + 10));
      if (raw) {
        const close = rawClose(raw[1], lt + 1);
        const gt = close === -1 ? -1 : lower.indexOf('>', close);
        if (gt !== -1) end = gt + 1;
      }
      if (end === -1 && /[a-z!/]/i.test(html[lt + 1] ?? '')) end = tagEnd(html, lt);
    }
    if (end === -1) { out += '<'; i = lt + 1; } else { out += ' '; i = end; }
  }
  return out.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&');
}

function readCaptureText(jdsDir, row) {
  if (!jdsDir) return null;
  const nums = linkedReportNumbers(row.report, row.notes);
  const slug = captureSlug(row.company);
  // An unusable slug (e.g. the `?` placeholder employer) cannot vouch for a
  // capture, and a number alone has matched the wrong company before.
  if (nums.length !== 1 || slug === '') return null;
  const hit = findCaptureForReport(jdsDir, nums[0], { companySlug: slug });
  if (!hit || !READABLE_CAPTURE_EXTS.has(hit.ext.toLowerCase())) return null;
  try {
    const buf = readFileSync(hit.path);
    const text = buf.subarray(0, MAX_CAPTURE_BYTES).toString('utf-8');
    return /^\.html?$/i.test(hit.ext) ? htmlToText(text) : text;
  } catch {
    return null;
  }
}

/**
 * Compute the closing-soon report from tracker markdown.
 *
 * @param {string} trackerMd
 * @param {object} opts
 * @param {Date} opts.today - UTC-midnight Date.
 * @param {number} [opts.within] - Window in days (inclusive of today).
 * @param {Set<string>} opts.statuses - Canonical status labels to include.
 * @param {string|null} [opts.jdsDir] - Captures directory; null disables.
 */
export function computeClosingSoon(trackerMd, { today, within = DEFAULT_WITHIN_DAYS, statuses, jdsDir = null, lookup = loadStateLookup() }) {
  const lines = String(trackerMd || '').replace(/\r\n/g, '\n').split('\n');
  const colmap = resolveColumns(lines);
  const wanted = new Set([...statuses].map(s => s.toLowerCase()));

  const closingSoon = [];
  const overdue = [];
  const unparsed = [];
  let rowsChecked = 0;

  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    const rawStatus = String(row.status || '').replace(/\*\*/g, '').trim();
    // Same states.yml lookup as --status, so an alias cell (e.g. `evaluada`) matches.
    const status = lookup.get(rawStatus.toLowerCase()) ?? rawStatus;
    if (!wanted.has(status.toLowerCase())) continue;
    rowsChecked++;

    let source = 'notes';
    let found = extractClosingDates(row.notes, today);
    // Notes win; the capture is consulted only when Notes carry no marker at
    // all, so a stale JD boilerplate "deadline" cannot contradict the user.
    if (found.dates.length === 0 && found.unparsed.length === 0) {
      const text = readCaptureText(jdsDir, row);
      if (text) {
        // JD prose ("deadline-driven team") is not a closing-date claim: only
        // date-shaped text that cannot be read is worth an `unparsed` entry.
        found = extractClosingDates(text, today, { strictMarkers: false });
        source = 'capture';
      }
    }

    const base = { num: row.num, company: row.company, role: row.role, status, source };
    if (found.dates.length === 0) {
      if (found.unparsed.length > 0) unparsed.push({ ...base, ...found.unparsed[0], markers: found.unparsed.length });
      continue;
    }

    // Several dates in one row: surface the earliest, since the cost of an
    // early warning is a glance and the cost of a late one is a lost posting.
    const sorted = [...found.dates].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const daysLeft = daysBetween(today, parseDate(first.date));
    const entry = { ...base, closes: first.date, daysLeft, marker: first.marker };
    const distinct = [...new Set(sorted.map(d => d.date))];
    if (distinct.length > 1) entry.allDates = distinct;

    if (daysLeft < 0) {
      const { daysLeft: _drop, ...rest } = entry;
      overdue.push({ ...rest, daysOverdue: -daysLeft });
    } else if (daysLeft <= within) {
      closingSoon.push(entry);
    }
  }

  closingSoon.sort((a, b) => a.daysLeft - b.daysLeft || a.num - b.num);
  overdue.sort((a, b) => a.daysOverdue - b.daysOverdue || a.num - b.num);
  unparsed.sort((a, b) => a.num - b.num);

  return { closingSoon, overdue, unparsed, rowsChecked };
}

/**
 * Interview days that closing dates pile up on.
 *
 * @param {object[]} closingSoon - `closingSoon` rows from computeClosingSoon.
 * @param {string} interviewsMd - data/active-interviews.md content.
 * @param {object} opts
 * @param {Date} opts.today - UTC-midnight Date.
 * @param {number} [opts.within] - Same window as the closing-soon report.
 * @param {number} [opts.clashMin] - Closing rows needed to call it a clash.
 * @returns {{date: string, interview: {company: string, role: string, time: string}, closing: object[]}[]}
 *   Soonest interview first. Interviews in a terminal Status, or whose Date/Time
 *   cell has no readable leading YYYY-MM-DD, are skipped.
 */
export function computeClashes(closingSoon, interviewsMd, { today, within = DEFAULT_WITHIN_DAYS, clashMin = DEFAULT_CLASH_MIN }) {
  const clashes = [];
  const rows = parseActiveInterviews(String(interviewsMd ?? '').replace(/\r\n/g, '\n'));
  for (const row of rows) {
    if (TERMINAL_INTERVIEW_RE.test(findColumn(row, 'status'))) continue;
    const time = findColumn(row, 'date/time').trim();
    const lead = /^(\d{4}-\d{2}-\d{2})(?!\d)/.exec(time);
    const when = lead ? parseDate(lead[1]) : null;
    if (!when) continue;
    const daysAway = daysBetween(today, when);
    if (daysAway < 0 || daysAway > within) continue;
    const day = isoDay(when);
    const eve = isoDay(new Date(when.getTime() - MS_PER_DAY));
    const closing = closingSoon.filter(r => r.closes === day || r.closes === eve);
    if (closing.length < clashMin) continue;
    clashes.push({
      date: day,
      interview: { company: findColumn(row, 'company').trim(), role: findColumn(row, 'role').trim(), time },
      closing,
    });
  }
  clashes.sort((a, b) => a.date.localeCompare(b.date));
  return clashes;
}

// --- CLI ---

const KNOWN_FLAGS = [
  '--within', '--status', '--today', '--tracker', '--jds',
  '--clashes', '--clash-min', '--interviews',
  '--json', '--summary', '--help', '-h',
];
const VALUE_FLAGS = ['--within', '--status', '--today', '--tracker', '--jds', '--clash-min', '--interviews'];

const USAGE = `Usage:
  node closing-soon.mjs                         # JSON report (default)
  node closing-soon.mjs --summary               # human-readable table
  node closing-soon.mjs --within <N>            # window in days (default ${DEFAULT_WITHIN_DAYS})
  node closing-soon.mjs --status <A[,B...]>     # canonical states to include (default ${DEFAULT_STATUS})
  node closing-soon.mjs --today <YYYY-MM-DD>    # evaluate as of a fixed date
  node closing-soon.mjs --tracker <path>        # a different applications.md
  node closing-soon.mjs --jds <dir>             # a different jds/ captures directory
  node closing-soon.mjs --clashes               # also flag interview days with closings piling up
  node closing-soon.mjs --clash-min <N>         # closings needed for a clash (default ${DEFAULT_CLASH_MIN}; needs --clashes)
  node closing-soon.mjs --interviews <path>     # a different active-interviews.md (needs --clashes)
  node closing-soon.mjs --help                  # show this message

Read-only: reads Notes (and jds/ captures when Notes have no closing marker)
and never writes to the tracker or any other file.`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function printSummary(report) {
  const { metadata, closingSoon, overdue, unparsed, clashes } = report;
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));
  const table = (rows, lastLabel, lastOf) => {
    console.log(`  ${'#'.padEnd(5)}${'Company'.padEnd(24)}${'Role'.padEnd(30)}${'Status'.padEnd(11)}${'Closes'.padEnd(12)}${lastLabel}`);
    for (const r of rows) {
      console.log(`  ${String(r.num).padEnd(5)}${clip(r.company, 22).padEnd(24)}${clip(r.role, 28).padEnd(30)}${clip(r.status, 9).padEnd(11)}${r.closes.padEnd(12)}${lastOf(r)}`);
    }
  };

  console.log(`\n${'='.repeat(86)}`);
  console.log('  Closing soon \u2014 career-ops');
  console.log(`  As of ${metadata.today} \u00b7 window ${metadata.within} day(s) \u00b7 status: ${metadata.statuses.join(', ')}`);
  console.log(`${'='.repeat(86)}\n`);

  console.log(`Closing within ${metadata.within} day(s): ${closingSoon.length}`);
  if (closingSoon.length) table(closingSoon, 'In', r => (r.daysLeft === 0 ? 'today' : `${r.daysLeft}d`));
  console.log(`\nOverdue (date already passed): ${overdue.length}`);
  if (overdue.length) table(overdue, 'Ago', r => `${r.daysOverdue}d`);
  console.log(`\nClosing marker found but date not readable: ${unparsed.length}`);
  for (const r of unparsed) {
    console.log(`  #${r.num} ${clip(r.company, 22)} \u2014 "${r.text}" (${r.reason}; ${r.source})`);
  }
  if (clashes) {
    console.log(`\nInterview-day clashes: ${clashes.length}`);
    for (const c of clashes) {
      const who = [c.interview.company, c.interview.role].filter(Boolean).join(' — ');
      console.log(`  ${c.date} ${who} (${c.interview.time})`);
      for (const r of c.closing) console.log(`    #${r.num} ${clip(r.company, 22)} — ${clip(r.role, 28)} (closes ${r.closes})`);
      console.log(`  -> ${c.closing.length} posting(s) close on or the day before this interview: submit these before the interview.`);
    }
  }
  console.log(`\nRows checked: ${metadata.rowsChecked}\n`);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (hasFlag(args, '--json') && hasFlag(args, '--summary')) fail('Choose one of --json or --summary.');

  const valueOf = (flag) => (hasFlag(args, flag) ? flagValue(args, flag) : null);

  let today;
  const todayArg = valueOf('--today');
  if (todayArg !== null) {
    today = parseDate(todayArg);
    if (!today) fail(`--today expects YYYY-MM-DD, received "${todayArg}".`);
  } else {
    today = parseDate(localToday());
  }

  let within = DEFAULT_WITHIN_DAYS;
  const withinArg = valueOf('--within');
  if (withinArg !== null) {
    if (!/^\d+$/.test(withinArg) || !Number.isSafeInteger(Number(withinArg))) {
      fail(`--within expects a non-negative whole number of days, received "${withinArg}".`);
    }
    within = Number(withinArg);
  }

  const clashesOn = hasFlag(args, '--clashes');
  if (!clashesOn && (hasFlag(args, '--clash-min') || hasFlag(args, '--interviews'))) {
    fail('--clash-min and --interviews only apply together with --clashes.');
  }
  let clashMin = DEFAULT_CLASH_MIN;
  const clashMinArg = valueOf('--clash-min');
  if (clashMinArg !== null) {
    if (!/^\d+$/.test(clashMinArg) || !Number.isSafeInteger(Number(clashMinArg)) || Number(clashMinArg) < 1) {
      fail(`--clash-min expects a whole number of at least 1, received "${clashMinArg}".`);
    }
    clashMin = Number(clashMinArg);
  }

  let statuses;
  try {
    statuses = resolveStatusFilter(valueOf('--status') ?? DEFAULT_STATUS);
  } catch (err) {
    fail(err.message);
  }

  const dataRoot = getCareerOpsRoot();
  const trackerPath = valueOf('--tracker') || resolveTrackerPath(dataRoot);
  const jdsDir = valueOf('--jds') || join(dataRoot, 'jds');

  const warnings = [];
  let trackerMd = '';
  if (existsSync(trackerPath)) {
    trackerMd = readFileSync(trackerPath, 'utf-8');
  } else {
    warnings.push(`No tracker found at ${trackerPath}; nothing to check.`);
  }

  const result = computeClosingSoon(trackerMd, { today, within, statuses, jdsDir });
  const report = {
    metadata: {
      today: isoDay(today),
      within,
      statuses: [...statuses],
      rowsChecked: result.rowsChecked,
      closingSoon: result.closingSoon.length,
      overdue: result.overdue.length,
      unparsed: result.unparsed.length,
    },
    closingSoon: result.closingSoon,
    overdue: result.overdue,
    unparsed: result.unparsed,
    warnings,
  };

  if (clashesOn) {
    const interviewsDefault = existsSync(join(dataRoot, 'data/active-interviews.md'))
      ? join(dataRoot, 'data/active-interviews.md')
      : join(dataRoot, 'active-interviews.md');
    // A relative --interviews override is resolved from the data root, not the cwd;
    // an absolute one is kept as given.
    const interviewsOverride = valueOf('--interviews');
    const interviewsPath = interviewsOverride ? resolve(dataRoot, interviewsOverride) : interviewsDefault;
    let interviewsMd = '';
    if (existsSync(interviewsPath)) {
      try {
        interviewsMd = readFileSync(interviewsPath, 'utf-8');
      } catch (err) {
        warnings.push(`Cannot read interviews file at ${interviewsPath} (${err.code || err.message}); no clashes to check.`);
      }
    } else {
      warnings.push(`No interviews file found at ${interviewsPath}; no clashes to check.`);
    }
    report.clashes = computeClashes(result.closingSoon, interviewsMd, { today, within, clashMin });
  }

  if (hasFlag(args, '--summary')) {
    printSummary(report);
    for (const w of warnings) console.log(w);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}
