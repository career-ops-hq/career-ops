#!/usr/bin/env node
/**
 * assessment-log.mjs — Skills-assessment event logger (eSkill, HackerRank, Criteria, ...)
 *
 * "Received a skills assessment" is its own pipeline event — not Applied /
 * Interview / Rejected — so it gets logged structurally instead of buried in
 * free-text notes. Each event is an append-only observation, never mutated:
 *   { date, company, report#, platform, subject, threshold, score, stale_note }
 *
 * The staleness signal is candidate-observed and self-reported (e.g. "test
 * content references Adobe Acrobat 9, a 2008-era version") — an empty
 * stale_note means no staleness was observed, not that the bank is current.
 *
 * Log lives in data/assessments.tsv (user layer, append-only, created on first
 * `add`). Threshold/score are percentages; both optional — vendors often hide
 * the threshold, and some platforms never reveal the score.
 *
 * Take-home / demo-recording assignments (#5733) share the file as an optional
 * `kind` (default skills-test) plus trailing columns 9-14:
 *   kind, deadline, deliverable, requirements_url, submitted_at, proof
 * Rows from before this change have 8 or fewer cells and parse as skills-test.
 * The log stays append-only: recording a submission appends a second row for the
 * same company+report#+subject (`submit`), and the newest non-empty value wins
 * when `open` folds the rows. Nothing is ever submitted by this tool.
 *
 * Future work (out of scope here): fold per-vendor staleness rates into
 * analyze-patterns.mjs the way ATS channel yield is analyzed today.
 *
 * Run: node assessment-log.mjs add --company <name> [--report <num>] \
 *        --platform <vendor> --subject <topic> [--threshold <pct>] \
 *        [--score <pct>] [--stale "<observed staleness note>"]
 *      node assessment-log.mjs add --kind take-home --company <name> \
 *        --platform <channel> --subject <topic> --deadline <ISO with offset> \
 *        [--deliverable video|file|link] [--requirements-url <url>] \
 *        [--submitted-at <ISO>] [--proof "<text or path>"]
 *      node assessment-log.mjs submit --company <name> --subject <topic> \
 *        [--report <num>] --submitted-at <ISO> [--proof "<text or path>"]
 *      node assessment-log.mjs open [--tz <IANA zone>] [--json]
 *      node assessment-log.mjs             (JSON)
 *      node assessment-log.mjs --summary   (human-readable)
 *      node assessment-log.mjs --self-test
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = getCareerOpsRoot();
const LOG_PATH = join(CAREER_OPS, 'data/assessments.tsv');

const KNOWN_FLAGS = ['--self-test', '--summary', '--help', '-h'];
const ADD_VALUE_FLAGS = ['--company', '--report', '--platform', '--subject', '--threshold', '--score', '--stale',
  '--kind', '--deadline', '--deliverable', '--requirements-url', '--submitted-at', '--proof'];
const OPEN_VALUE_FLAGS = ['--tz'];
const OPEN_FLAGS = ['--json'];
export const KINDS = ['skills-test', 'take-home'];
export const DELIVERABLES = ['video', 'file', 'link'];
export const WARN_HOURS = 48;

const USAGE = `Usage:
  node assessment-log.mjs add --company <name> [--report <num>] --platform <vendor> --subject <topic> [--threshold <pct>] [--score <pct>] [--stale "<note>"]
  node assessment-log.mjs add --kind take-home --company <name> --platform <channel> --subject <topic> --deadline <ISO with offset> [--deliverable video|file|link] [--requirements-url <url>] [--submitted-at <ISO>] [--proof "<text|path>"]
  node assessment-log.mjs submit --company <name> --subject <topic> [--report <num>] --submitted-at <ISO> [--proof "<text|path>"]   # records a submission you already made; submits nothing
  node assessment-log.mjs open [--tz <IANA zone>] [--json]   # open take-homes by deadline, converted to your timezone
  node assessment-log.mjs                         # print the assessment log as JSON
  node assessment-log.mjs --summary               # print a human-readable summary
  node assessment-log.mjs --self-test             # run the in-memory test suite
  node assessment-log.mjs --help                  # print this usage block and exit (-h is an alias)`;

const HEADER_COMMENT = [
  '# assessments.tsv — append-only skills-assessment log (user layer). Never rewrite rows.',
  '# {YYYY-MM-DD}\\t{company}\\t{report#|-}\\t{platform}\\t{subject}\\t{threshold%|-}\\t{score%|-}\\t{stale_note}',
  '# optional trailing cells: \\t{kind}\\t{deadline}\\t{deliverable}\\t{requirements_url}\\t{submitted_at}\\t{proof}  (kind: skills-test|take-home)',
].join('\n');

// --- Percent parsing ---
// Tolerant: "70", "70%", "70.5 %" all parse; blank/-/? -> null (unknown, not zero).
export function parsePct(raw) {
  const s = String(raw ?? '').trim().replace(/%\s*$/, '').trim();
  if (!s || s === '-' || s === '?' || /^(n\/?a|null)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// --- Log parsing (TSV) ---
// line: {YYYY-MM-DD}\t{company}\t{report#|-}\t{platform}\t{subject}\t{threshold|-}\t{score|-}\t{stale_note}
// Optional trailing cells may be absent entirely (hand-written rows) — parsing
// stays tolerant; only date+company+platform+subject are structurally required.
export function parseAssessments(content) {
  const rows = [];
  const malformed = [];
  for (const line of String(content || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split('\t').map(c => c.trim());
    const [date, company, reportNum = '', platform = '', subject = '', threshold = '', score = '', staleNote = '',
      kindRaw = '', deadline = '', deliverable = '', requirementsUrl = '', submittedAt = '', proof = ''] = cells;
    const kind = kindRaw === '' || kindRaw === '-' ? 'skills-test' : kindRaw;
    if (cells.length < 5 || !date || !company || !platform || !subject || !KINDS.includes(kind)) {
      malformed.push({ line: t.slice(0, 80) });
      continue;
    }
    const norm = (v) => (v === '' || v === '-' ? null : v);
    rows.push({
      date, company,
      reportNum: norm(reportNum),
      platform, subject,
      threshold: parsePct(threshold),
      score: parsePct(score),
      staleNote: norm(staleNote),
      kind,
      deadline: norm(deadline),
      deliverable: norm(deliverable),
      requirementsUrl: norm(requirementsUrl),
      submittedAt: norm(submittedAt),
      proof: norm(proof),
    });
  }
  return { rows, malformed };
}

// --- Aggregation ---
export function summarize(rows, malformed = []) {
  const byPlatform = {};
  let staleFlagged = 0;
  for (const r of rows) {
    // Take-home assignments have no threshold/score; counting them would pad
    // every platform's "unknown outcome" tally. They are read via `open`.
    if (r.kind === 'take-home') continue;
    byPlatform[r.platform] ??= { count: 0, staleFlagged: 0, passed: 0, failed: 0, unknownOutcome: 0 };
    const agg = byPlatform[r.platform];
    agg.count += 1;
    if (r.staleNote) { agg.staleFlagged += 1; staleFlagged += 1; }
    // Pass/fail only when BOTH threshold and score are known — a lone score
    // with a hidden threshold proves nothing either way.
    if (r.threshold !== null && r.score !== null) {
      if (r.score >= r.threshold) agg.passed += 1; else agg.failed += 1;
    } else {
      agg.unknownOutcome += 1;
    }
  }
  return {
    assessments: rows,
    aggregates: { byPlatform },
    quality: {
      total: rows.length,
      staleFlagged,
      withoutScore: rows.filter(r => r.kind !== 'take-home' && r.score === null).length,
      withoutThreshold: rows.filter(r => r.kind !== 'take-home' && r.threshold === null).length,
      malformedLines: malformed,
    },
  };
}

// --- Append (`add` subcommand) ---
export function buildRow(fields, today) {
  const req = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (!v) throw new Error(`--${name} is required`);
    if (v.includes('\t') || v.includes('\n')) throw new Error(`--${name} must not contain tabs or newlines`);
    return v;
  };
  const opt = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (v.includes('\t') || v.includes('\n')) throw new Error(`--${name} must not contain tabs or newlines`);
    return v || '-';
  };
  const optPct = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (!v) return '-';
    if (parsePct(v) === null) throw new Error(`--${name} must be a percentage (e.g. 70 or 70%), got "${v}"`);
    return v;
  };
  const kind = String(fields.kind ?? '').trim() || 'skills-test';
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}, got "${kind}"`);
  const base = [
    today, req('company'), opt('report'), req('platform'), req('subject'),
    optPct('threshold'), optPct('score'), opt('stale') === '-' ? '' : opt('stale'),
  ];
  const tail = ['deadline', 'deliverable', 'requirements-url', 'submitted-at', 'proof'].map(k => opt(k));
  if (kind === 'skills-test') {
    if (tail.some(v => v !== '-')) {
      throw new Error('--deadline/--deliverable/--requirements-url/--submitted-at/--proof need --kind take-home');
    }
    return base.join('\t'); // byte-identical to the pre-#5733 format
  }
  if (tail[0] !== '-' && !isOffsetDateTime(tail[0])) {
    throw new Error(`--deadline must be an ISO date-time with the sender's UTC offset or Z (e.g. 2026-11-02T17:00:00-08:00), got "${tail[0]}"`);
  }
  if (tail[1] !== '-' && !DELIVERABLES.includes(tail[1])) {
    throw new Error(`--deliverable must be one of ${DELIVERABLES.join(', ')}, got "${tail[1]}"`);
  }
  if (tail[3] !== '-' && !isIsoDate(tail[3]) && !isLocalDateTime(tail[3]) && !isOffsetDateTime(tail[3])) {
    throw new Error(`--submitted-at must be an ISO date or date-time, got "${tail[3]}"`);
  }
  return [...base, kind, ...tail].join('\t');
}

// --- Take-home deadlines ---
// Strict calendar and clock validation: Date.parse accepts or silently rolls over
// values such as 2026-02-30 and offsets like +99:99, so check the fields explicitly.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/;
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

function validCalendarDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function validClock(h, min, s) {
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 && (s === undefined || (s >= 0 && s <= 59));
}

/** YYYY-MM-DD that is a real calendar date. */
export function isIsoDate(v) {
  const m = typeof v === 'string' ? DATE_RE.exec(v) : null;
  return !!m && validCalendarDate(+m[1], +m[2], +m[3]);
}

/** YYYY-MM-DDTHH:MM[:SS] with a real date and clock, no offset. */
export function isLocalDateTime(v) {
  const m = typeof v === 'string' ? LOCAL_DATETIME_RE.exec(v) : null;
  return !!m && validCalendarDate(+m[1], +m[2], +m[3]) && validClock(+m[4], +m[5], m[6] === undefined ? undefined : +m[6]);
}

/** Date-time with Z or a +/-HH:MM offset (hours 0-14, minutes 0-59). */
export function isOffsetDateTime(v) {
  const m = typeof v === 'string' ? OFFSET_DATETIME_RE.exec(v) : null;
  if (!m) return false;
  if (!validCalendarDate(+m[1], +m[2], +m[3])) return false;
  if (!validClock(+m[4], +m[5], m[6] === undefined ? undefined : +m[6])) return false;
  if (m[7] === 'Z') return true;
  const oh = +m[9], om = +m[10];
  return oh <= 14 && om <= 59;
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

// Zone precedence: --tz, then config/profile.yml location.timezone (only if it is
// an Area/City IANA name — the example profile ships an abbreviation like "PST", which is
// ambiguous and is ignored), then the machine's zone.
export function resolveTimeZone(flagTz, profilePath = getProfilePath()) {
  if (flagTz) {
    if (!isValidTimeZone(flagTz)) throw new Error(`--tz "${flagTz}" is not a valid IANA timezone (e.g. America/Toronto)`);
    return { tz: flagTz, source: '--tz' };
  }
  try {
    if (profilePath && existsSync(profilePath)) {
      const cand = (loadYaml(readFileSync(profilePath, 'utf-8')) || {})?.location?.timezone;
      if (typeof cand === 'string' && cand.includes('/') && isValidTimeZone(cand)) return { tz: cand, source: 'config/profile.yml' };
    }
  } catch { /* unreadable profile -> fall through */ }
  return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, source: 'machine' };
}

export function formatInZone(iso, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).formatToParts(new Date(iso)).map(p => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

const takeHomeKey = (r) => [r.company, r.reportNum ?? '', r.subject].join('\u0000').toLowerCase();

// Fold append-only rows into one current record per assignment
// (company + report# + subject); a later non-empty value overrides an earlier one.
export function foldTakeHomes(rows) {
  const byKey = new Map();
  for (const r of rows) {
    if (r.kind !== 'take-home') continue;
    const key = takeHomeKey(r);
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...r }); continue; }
    for (const f of ['deadline', 'deliverable', 'requirementsUrl', 'submittedAt', 'proof', 'platform']) {
      if (r[f]) prev[f] = r[f];
    }
  }
  return [...byKey.values()];
}

// Open (unsubmitted) take-homes, soonest deadline first (no deadline last).
// warn = due within WARN_HOURS and not submitted; overdue = deadline passed.
export function openTakeHomes(rows, { tz, now = new Date() }) {
  const open = foldTakeHomes(rows).filter(r => !r.submittedAt).map(r => {
    const t = r.deadline ? Date.parse(r.deadline) : NaN;
    const hoursLeft = Number.isNaN(t) ? null : (t - now.getTime()) / 3600000;
    return {
      company: r.company, reportNum: r.reportNum, subject: r.subject, platform: r.platform,
      deliverable: r.deliverable, requirementsUrl: r.requirementsUrl,
      deadline: r.deadline,
      deadlineLocal: Number.isNaN(t) ? null : formatInZone(r.deadline, tz),
      hoursLeft: hoursLeft === null ? null : Math.round(hoursLeft * 10) / 10,
      overdue: hoursLeft !== null && hoursLeft < 0,
      warn: hoursLeft !== null && hoursLeft >= 0 && hoursLeft <= WARN_HOURS,
    };
  });
  open.sort((a, b) => (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity));
  return open;
}

function printOpen(open, tz, source) {
  console.log(`\nOPEN TAKE-HOME ASSIGNMENTS — deadlines shown in ${tz} (${source})\n`);
  if (!open.length) { console.log('  None open.\n'); return; }
  for (const a of open) {
    const mark = a.overdue ? 'OVERDUE' : a.warn ? `DUE IN ${Math.floor(a.hoursLeft)}h` : '       ';
    const ref = a.reportNum ? ` (#${a.reportNum})` : '';
    const how = a.deliverable ? ` [${a.deliverable}]` : '';
    console.log(`  ${a.overdue || a.warn ? '⚠' : ' '} ${a.deadlineLocal ?? 'no deadline'}  ${a.company}${ref} — ${a.subject}${how}  ${mark}`.trimEnd());
    if (a.requirementsUrl) console.log(`      requirements: ${a.requirementsUrl}`);
  }
  console.log('');
}

function addEntry(args, mode = 'add') {
  const fields = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--(company|report|platform|subject|threshold|score|stale|kind|deadline|deliverable|requirements-url|submitted-at|proof)$/);
    if (m) { fields[m[1]] = args[i + 1] ?? ''; i++; }
  }
  // LOCAL day: this is the date written into the appended assessments.tsv row,
  // and the UTC day stamped a user record with a day that had not happened yet
  // for anyone west of Greenwich (#3070).
  const today = localToday();
  let row;
  try {
    if (mode === 'submit') {
      // Append-only: record a submission as a NEW row for an existing take-home,
      // never by rewriting the original. Platform/deadline/etc. come from the
      // folded earlier rows; this command submits nothing anywhere.
      if (!String(fields['submitted-at'] ?? '').trim()) throw new Error('--submitted-at is required');
      const existing = existsSync(LOG_PATH) ? parseAssessments(readFileSync(LOG_PATH, 'utf-8')).rows : [];
      const want = takeHomeKey({ company: String(fields.company ?? '').trim(), reportNum: String(fields.report ?? '').trim() || null, subject: String(fields.subject ?? '').trim() });
      const prior = foldTakeHomes(existing).find(r => takeHomeKey(r) === want);
      if (!prior) throw new Error('no logged take-home matches --company/--report/--subject (add it first with --kind take-home)');
      fields.kind = 'take-home';
      fields.platform = prior.platform;
      fields.deadline = prior.deadline ?? '';
      fields.deliverable = prior.deliverable ?? '';
      fields['requirements-url'] = prior.requirementsUrl ?? '';
    }
    row = buildRow(fields, today);
  } catch (e) {
    console.error(`assessment-log: ${e.message}`);
    console.error(USAGE);
    process.exit(1);
  }
  // Append-only: existing rows are never rewritten. Create with header comment on first use.
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  let prefix;
  if (existsSync(LOG_PATH)) {
    const existing = readFileSync(LOG_PATH, 'utf-8');
    prefix = existing.endsWith('\n') || existing === '' ? '' : '\n';
  } else {
    prefix = HEADER_COMMENT + '\n';
  }
  appendFileSync(LOG_PATH, prefix + row + '\n');
  console.log(JSON.stringify({ added: true, row: row.split('\t') }, null, 2));
}

// --- Self-test (in-memory fixtures, no file writes) ---
const LOG_FIXTURE = [
  '# comment line',
  '2026-07-01\tAcme\t042\teSkill\tMS Office\t70\t92\treferences Adobe Acrobat 9 (2008-era)',
  '2026-07-02\tGlobex\t-\tHackerRank\tJavaScript\t-\t85\t',
  '2026-07-03\tInitech\t013\tCriteria\tCognitive Aptitude\t65\t60\t',
  '2026-07-04\tHooli\t-\tPredictive Index\tBehavioral\t-\t-\t',
  '2026-07-05\tUmbrella\t017\teSkill\tOutlook\t70\t95\told Outlook web UI, nothing currently shipping',
  '2026-07-06\tAcme', // malformed on purpose — too few cells
].join('\n');

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  // parsePct
  assert(parsePct('70') === 70, '70 -> 70');
  assert(parsePct('70%') === 70, '70% -> 70');
  assert(parsePct('70.5 %') === 70.5, 'decimal with spaced % sign');
  assert(parsePct('-') === null, '- -> null');
  assert(parsePct('') === null, 'blank -> null');
  assert(parsePct('?') === null, '? -> null');
  assert(parsePct('n/a') === null, 'n/a -> null');
  assert(parsePct('high') === null, 'prose -> null');

  // parseAssessments
  const { rows, malformed } = parseAssessments(LOG_FIXTURE);
  assert(rows.length === 5, `5 rows parsed, got ${rows.length}`);
  assert(malformed.length === 1, `1 malformed line reported, got ${malformed.length}`);
  assert(rows[0].company === 'Acme' && rows[0].platform === 'eSkill' && rows[0].reportNum === '042', 'fields mapped');
  assert(rows[0].threshold === 70 && rows[0].score === 92, 'threshold/score parsed');
  assert(rows[0].staleNote.includes('Acrobat 9'), 'stale note preserved');
  assert(rows[1].reportNum === null && rows[1].threshold === null, 'optional cells -> null');
  assert(rows[3].score === null && rows[3].staleNote === null, 'no-score no-stale row tolerated');
  assert(parseAssessments('').rows.length === 0, 'empty log');
  // trailing cells absent entirely (hand-written short row) must still parse
  const short = parseAssessments('2026-07-01\tAcme\t-\teSkill\tExcel').rows;
  assert(short.length === 1 && short[0].score === null && short[0].staleNote === null, 'short row (5 cells) tolerated');

  // summarize
  const result = summarize(rows, malformed);
  assert(result.quality.total === 5, 'total 5');
  assert(result.quality.staleFlagged === 2, `2 stale-flagged, got ${result.quality.staleFlagged}`);
  assert(result.quality.withoutScore === 1 && result.quality.withoutThreshold === 2, 'missing-field counts');
  assert(result.quality.malformedLines.length === 1, 'malformed line surfaced in quality');
  const eskill = result.aggregates.byPlatform['eSkill'];
  assert(eskill.count === 2 && eskill.staleFlagged === 2 && eskill.passed === 2, 'eSkill: 2 events, both stale-flagged, both passed');
  const criteria = result.aggregates.byPlatform['Criteria'];
  assert(criteria.failed === 1 && criteria.passed === 0, 'Criteria: score below threshold -> failed');
  // lone score with hidden threshold must NOT count as passed
  const hr = result.aggregates.byPlatform['HackerRank'];
  assert(hr.passed === 0 && hr.unknownOutcome === 1, 'hidden threshold -> unknown outcome, not a pass');
  const pi = result.aggregates.byPlatform['Predictive Index'];
  assert(pi.unknownOutcome === 1, 'no threshold + no score -> unknown outcome');

  // buildRow
  const row = buildRow({ company: 'Acme', report: '042', platform: 'eSkill', subject: 'MS Office', threshold: '70', score: '92', stale: 'Acrobat 9' }, '2026-07-07');
  assert(row === '2026-07-07\tAcme\t042\teSkill\tMS Office\t70\t92\tAcrobat 9', 'full row built');
  const minimal = buildRow({ company: 'Acme', platform: 'eSkill', subject: 'Excel' }, '2026-07-07');
  assert(minimal === '2026-07-07\tAcme\t-\teSkill\tExcel\t-\t-\t', 'optional fields default to -/empty');
  // round-trip: built rows must parse back losslessly
  const rt = parseAssessments(row + '\n' + minimal).rows;
  assert(rt.length === 2 && rt[0].score === 92 && rt[1].threshold === null, 'built rows round-trip through parser');
  const throws = (fields, frag) => {
    try { buildRow(fields, '2026-07-07'); return false; } catch (e) { return e.message.includes(frag); }
  };
  assert(throws({ platform: 'eSkill', subject: 'Excel' }, '--company is required'), 'missing company rejected');
  assert(throws({ company: 'Acme', platform: 'eSkill', subject: 'Excel', threshold: 'high' }, '--threshold must be a percentage'), 'prose threshold rejected');
  assert(throws({ company: 'A\tcme', platform: 'eSkill', subject: 'Excel' }, 'tabs'), 'embedded tab rejected');

  console.log('assessment-log self-test OK (pct parser + TSV parser + aggregation + row builder)');
}

// --- Output ---
function printSummary(result) {
  const { aggregates, quality, assessments } = result;
  console.log('\nSKILLS ASSESSMENTS — per-application events\n');

  if (!assessments.length) {
    console.log('  No assessments logged yet.');
    console.log('  Log one: node assessment-log.mjs add --company <name> --platform <vendor> --subject <topic>');
  } else {
    console.log('  Events:');
    for (const a of assessments) {
      if (a.kind === 'take-home') {
        console.log(`  ${a.date} ${a.company}${a.reportNum ? ` (#${a.reportNum})` : ''} — take-home: ${a.subject}${a.submittedAt ? ` (submitted ${a.submittedAt})` : ''}`);
        continue;
      }
      const ref = a.reportNum ? ` (#${a.reportNum})` : '';
      const outcome = a.threshold !== null && a.score !== null
        ? `${a.score}% vs threshold ${a.threshold}% — ${a.score >= a.threshold ? 'passed' : 'failed'}`
        : [a.score !== null ? `score ${a.score}%` : null, a.threshold !== null ? `threshold ${a.threshold}%` : null].filter(Boolean).join(', ') || 'no score/threshold reported';
      console.log(`  ${a.date} ${a.company}${ref} — ${a.platform}: ${a.subject}`);
      console.log(`      ${outcome}`);
      if (a.staleNote) console.log(`      ⚠ stale: ${a.staleNote}`);
    }
    console.log('\n  By platform:');
    for (const [platform, agg] of Object.entries(aggregates.byPlatform)) {
      const stale = agg.staleFlagged ? `, ${agg.staleFlagged} stale-flagged` : '';
      console.log(`  ${platform}: ${agg.count} event${agg.count === 1 ? '' : 's'} (${agg.passed} passed, ${agg.failed} failed, ${agg.unknownOutcome} unknown${stale})`);
    }
  }

  console.log('\n  Data quality:');
  console.log(`  stale-flagged (candidate-observed): ${quality.staleFlagged} of ${quality.total}`);
  console.log(`  without score: ${quality.withoutScore}, without threshold: ${quality.withoutThreshold}`);
  if (quality.malformedLines.length) {
    console.log(`  ⚠ ${quality.malformedLines.length} malformed line${quality.malformedLines.length === 1 ? '' : 's'} skipped (need date, company, platform, subject):`);
    for (const m of quality.malformedLines) console.log(`      "${m.line}"`);
  } else {
    console.log('  malformed lines: none');
  }
  console.log('');
}

function openCommand(args) {
  const tzIdx = args.indexOf('--tz');
  let zone;
  try {
    if (tzIdx >= 0 && (args[tzIdx + 1] === undefined || args[tzIdx + 1].startsWith('--'))) {
      throw new Error('--tz requires an IANA timezone (e.g. America/Toronto)');
    }
    zone = resolveTimeZone(tzIdx >= 0 ? args[tzIdx + 1] : undefined);
  } catch (e) {
    console.error(`assessment-log: ${e.message}`);
    process.exit(1);
  }
  const content = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf-8') : '';
  const open = openTakeHomes(parseAssessments(content).rows, { tz: zone.tz });
  if (args.includes('--json')) console.log(JSON.stringify({ timeZone: zone.tz, timeZoneSource: zone.source, open }, null, 2));
  else printOpen(open, zone.tz, zone.source);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // Values passed to the add subcommand remain positional data even when they
  // start with a dash (for example an explicitly unknown "-" percentage).
  // Only a leading-dash argument outside those value slots is a CLI flag.
  const valueFlags = args[0] === 'add' || args[0] === 'submit' ? ADD_VALUE_FLAGS : args[0] === 'open' ? OPEN_VALUE_FLAGS : [];
  const consumedValueIndices = new Set();
  if (valueFlags.length) {
    args.forEach((arg, index) => {
      if (valueFlags.includes(arg) && args[index + 1] !== undefined && !args[index + 1].startsWith('--')) {
        consumedValueIndices.add(index + 1);
      }
    });
  }

  const validFlags = [...KNOWN_FLAGS, ...valueFlags, ...(args[0] === 'open' ? OPEN_FLAGS : [])];
  const unknownFlags = args.filter((arg, index) =>
    arg.startsWith('-') && !consumedValueIndices.has(index) && !validFlags.includes(arg));
  if (unknownFlags.length) {
    console.error(`assessment-log: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${validFlags.join(', ')}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (args.includes('--self-test')) { selfTest(); return; }
  if (args[0] === 'add' || args[0] === 'submit') { addEntry(args.slice(1), args[0]); return; }
  if (args[0] === 'open') { openCommand(args.slice(1)); return; }

  const content = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf-8') : '';
  const { rows, malformed } = parseAssessments(content);
  const result = summarize(rows, malformed);

  if (args.includes('--summary')) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
