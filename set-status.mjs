#!/usr/bin/env node

/**
 * set-status.mjs — canonical CLI to update a tracker row's status/note (#1428).
 *
 * data/applications.md is a shared surface with multiple readers and writers.
 * One canonical write path is safer than N agents hand-editing markdown, so
 * modes (apply Step 9, followup, batch) call this instead of editing the table.
 *
 * Usage:
 *   node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--force] [--dry-run] [--json]
 *
 * Row resolution:
 *   - --row N     → exact match on the # column, stated explicitly
 *   - --report N  → match the row whose Report cell links report #N
 *   - numeric argument → exact match on the # column; if the tracker has a
 *     duplicate # (see #1704 — merge-tracker.mjs bug, now fixed, that could
 *     assign the same # to two rows), --role narrows it, otherwise it fails
 *     ambiguous with a candidate list instead of silently editing whichever
 *     row was found first
 *   - otherwise → company match (normalized, same key as merge-tracker dedup);
 *     multiple hits are narrowed with --role (fuzzy, role-matcher.mjs), and
 *     anything still ambiguous fails with a numbered candidate list.
 *
 * Why --row/--report exist:
 *   Tracker row IDs and report IDs are two independent counters sharing one
 *   number space. reserve-report-num.mjs treats tracker row IDs as occupied
 *   when allocating a report number, so the sequences leapfrog and never
 *   realign; every row added WITHOUT an evaluation report (backfilled rows,
 *   #1799) widens the gap permanently. A bare numeric selector is therefore
 *   genuinely ambiguous — "97" may mean row #97 or report #97, which are
 *   different applications — and the report-number-mismatch guard below fires
 *   on every such call once the counters have diverged. A guard that fires
 *   almost always trains callers to reach for --force, which disables it
 *   everywhere including the cases it was written for.
 *
 *   --row and --report remove the ambiguity instead of suppressing the check.
 *   Both state which number space the caller means, so the mismatch guard is
 *   skipped as ANSWERED rather than overridden — unlike --force, which
 *   silences it while the ambiguity is still real.
 *
 * State validation is strict against templates/states.yml (labels, ids, and
 * aliases resolve to the canonical label; anything else is rejected before the
 * tracker is touched). --note appends to the Notes cell with "; " and is
 * idempotent — re-running the same command is always safe.
 *
 * The read-modify-write runs under the shared tracker lock (tracker-utils.mjs,
 * same lock as merge-tracker.mjs) and the file is replaced atomically. Only the
 * Status and Notes cells of the matched row change; every other byte of the
 * tracker round-trips untouched.
 *
 * Exit codes: 0 success (including no-op re-runs) · 1 usage error,
 * non-canonical state, unreadable states.yml, or non-retryable lock/write failure ·
 * 2 row not found or unreadable tracker · 3 ambiguous company match ·
 * 4 tracker lock timeout (busy — retry later).
 *
 * When the new status is Applied, the JSON output carries
 * `"followupSeedCandidate": true` — the hook point for seeding
 * data/follow-ups.md with the default cadence (#1430, not implemented here).
 *
 * Every real status change also appends one line to the transition ledger
 * (status-log.tsv, sibling of the tracker file):
 *   {tracker#}\t{date}\t{from}\t{to}\t{source}\t
 * Source is `set-status` unless --source names the caller delegating here.
 * Date defaults to today; pass --on YYYY-MM-DD when the transition actually
 * happened earlier ("they replied Tuesday"). The append is observation-only:
 * if it fails, a warning goes to stderr and the exit code is unchanged — the
 * tracker remains the source of truth for state. Read by funnel-velocity.mjs.
 *
 * Two rules the reader enforces that this writer never has to think about,
 * because it always has a real prior status and always writes its own source.
 * Any other producer does have to, so they are stated here:
 *   - An unknown from- or to-state is the sentinel "-", never an empty cell.
 *     funnel-velocity.mjs reads the two columns differently: a from of "-"
 *     parses to null, meaning no prior state, while a to of "-" is preserved
 *     as the literal "-", meaning an unknown target. Any other value goes
 *     through resolveCanonicalState, so an empty cell is rejected as
 *     `unknown from-state ""` or `unknown to-state ""` for its own column,
 *     and the row is dropped.
 *   - The source column is a closed set, and VALID_SOURCES in
 *     funnel-velocity.mjs is the authority on its members. Deliberately not
 *     enumerated here: a copy of that list in prose is wrong the first time a
 *     writer is added, and it would be wrong in three files at once.
 *     A value outside the set parses but is excluded from day-math. The row
 *     is not lost and the exclusion is not silent: it is kept as an
 *     observation, recorded in unknownSources, and printed with its line
 *     number under dataQuality. Namespacing a source (say "backfill:notes")
 *     therefore keeps the row out of the day-math figures; put that detail in
 *     the note column.
 */

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow, normalizeTextKey } from './tracker-parse.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { localToday } from './lib/local-today.mjs';
import {
  rebuildRow, resolveTrackerPath, writeFileAtomic, loadCanonicalStates, resolveCanonicalState,
  normalizeCompany, cell, CLI_EXIT, makeCliFailWith, acquireTrackerLockForCli,
} from './tracker-utils.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CAREER_OPS, 'templates/states.yml');

// LOCK_TIMEOUT is not destructured here — that exit path is raised inside
// acquireTrackerLockForCli() itself (tracker-utils.mjs), via CLI_EXIT.LOCK_TIMEOUT.
const { OK: EXIT_OK, USAGE: EXIT_USAGE, NOT_FOUND: EXIT_NOT_FOUND, AMBIGUOUS: EXIT_AMBIGUOUS } = CLI_EXIT;

const USAGE = `Usage: node set-status.mjs <report#|company> <state> [--note "..."] [--role "..."] [--on YYYY-MM-DD] [--force] [--dry-run] [--json]
       node set-status.mjs --row N <state> [...]        (explicit tracker row ID)
       node set-status.mjs --report N <state> [...]     (explicit report ID)

  <report#|company>  Row selector: tracker # (exact) or company name (normalized match)
  <state>            Canonical state from templates/states.yml (aliases accepted)
  --row N            Select by tracker # explicitly (unambiguous; skips the mismatch guard)
  --report N         Select the row whose Report cell links report #N
  --note "..."       Append to the Notes cell ("; "-separated, idempotent)
  --role "..."       Disambiguate when several rows share the company (fuzzy match)
  --on YYYY-MM-DD    Real event date for the status-log entry (defaults to today —
                     pass it when the transition happened earlier than it's recorded)
  --source NAME      Attribution for the transition ledger: set-status (default)
                     or web (a caller delegating to this script)
  --force            Allow a numeric selector despite a report-link mismatch, or despite a
                     report-less row whose number another row claims as its report link
  --dry-run          Resolve and validate, but write nothing
  --json             Machine-readable output on stdout (errors included)

  Tracker row IDs and report IDs are separate counters that diverge permanently
  once any row exists without a report. Prefer --row/--report (or the company
  name) over a bare number, and prefer any of them over --force.`;

// ── argument parsing ─────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = { note: null, role: null, on: null, row: null, report: null, source: null, force: false, dryRun: false, json: false };
const VALUE_FLAGS = { '--note': 'note', '--role': 'role', '--on': 'on', '--row': 'row', '--report': 'report', '--source': 'source' };

// Who is driving this write. A caller that delegates here instead of touching
// the tracker itself — the web status route — needs its ledger rows to stay
// distinguishable from a CLI run's.
//
// The allow-list is narrow on purpose. The value is written to a file
// funnel-velocity.mjs parses positionally and gates on its own source
// allow-list, so an unrecognized label would be persisted here and then
// silently dropped there. Rejecting it at the boundary keeps the two ends from
// disagreeing about what a valid source is.
const WRITER_SOURCES = new Set(['set-status', 'web', 'reply-watch']);

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a in VALUE_FLAGS) {
    // Never consume a following flag as the value: "--note --dry-run" would
    // silently disable dry-run and turn a preview into a real write.
    const value = rawArgs[i + 1];
    if (value === undefined || value.startsWith('--')) {
      failUsage(`Missing value for ${a}`);
    }
    // --row/--report name a row by number; a non-numeric value is a typo, and
    // silently treating it as "no match" would hide the mistake.
    if ((a === '--row' || a === '--report') && !/^\d+$/.test(value)) {
      failUsage(`${a} expects a positive integer, got "${value}"`);
    }
    if (a === '--source' && !WRITER_SOURCES.has(value)) {
      failUsage(`--source expects one of ${[...WRITER_SOURCES].join(', ')}, got "${value}"`);
    }
    flags[VALUE_FLAGS[a]] = value;
    i++;
  }
  else if (a === '--force') { flags.force = true; }
  else if (a === '--dry-run') { flags.dryRun = true; }
  else if (a === '--json') { flags.json = true; }
  else if (a.startsWith('--')) { failUsage(`Unknown flag: ${a}`); }
  else { positional.push(a); }
}

// --row and --report ARE the selector, so they replace the positional one.
// Accepting both would leave two competing answers to "which row?"; refuse
// rather than pick, since picking wrong writes to the wrong application.
if (flags.row !== null && flags.report !== null) {
  failUsage('--row and --report are mutually exclusive — they name different number spaces');
}
const explicitSelector = flags.row !== null || flags.report !== null;

if (explicitSelector) {
  if (positional.length !== 1) {
    failUsage(positional.length === 0
      ? `Expected the state after ${flags.row !== null ? '--row' : '--report'}`
      : `With ${flags.row !== null ? '--row' : '--report'} the only positional argument is the state, got ${positional.length}`);
  }
} else if (positional.length !== 2) {
  failUsage(positional.length === 0 ? null : `Expected 2 arguments (selector, state), got ${positional.length}`);
}

// --on must be a real, non-future calendar date — validated before anything
// touches the tracker, same as state validation below.
if (flags.on !== null) {
  const m = /^\d{4}-\d{2}-\d{2}$/.test(flags.on);
  const d = m ? new Date(`${flags.on}T00:00:00Z`) : null;
  const roundTrips = d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === flags.on;
  if (!roundTrips) failUsage(`--on expects a real date as YYYY-MM-DD, got "${flags.on}"`);
  // LOCAL today, not the UTC day. At a positive UTC offset the UTC day is
  // still yesterday for the first hours of the local day, so comparing against
  // it rejected the user's own today: `TZ=Pacific/Auckland --on 2026-08-16`
  // failed with "date is in the future" on 2026-08-16 (#2932). The round-trip
  // check above deliberately stays on UTC — that is date PARSING, not "what
  // day is it here".
  if (flags.on > localToday()) failUsage(`--on date is in the future: "${flags.on}"`);
}

const selector = explicitSelector ? null : positional[0];
const stateInput = explicitSelector ? positional[0] : positional[1];

// A bare positional number is the ambiguous case the mismatch guard exists for.
// --row/--report are numeric too but carry an explicit number space, so they
// must not be treated as ambiguous.
const isBareNumericSelector = selector !== null && /^\d+$/.test(selector);

// Shared with every other canonical tracker-writer CLI (tracker-utils.mjs) so
// the JSON-vs-human error contract can't drift between them.
const failWith = makeCliFailWith(flags.json);

/**
 * Print usage (plus an optional specific complaint) and exit 1.
 *
 * With --json a structured usage-error payload goes to stdout (same shape as
 * failWith) so machine callers always parse one stream. failUsage can fire
 * mid-argv-parse — before flags.json is settled — so JSON mode is detected
 * from the raw argv directly.
 *
 * @param {string|null} message - What was wrong with the invocation, if known.
 * @returns {never}
 */
function failUsage(message) {
  const msg = message ?? 'Expected 2 arguments: <report#|company> <state>';
  if (rawArgs.includes('--json')) {
    console.log(JSON.stringify({ error: msg, code: 'usage' }));
    console.error(`❌ ${msg}`);
  } else {
    if (message) console.error(`❌ ${message}\n`);
    console.error(USAGE);
  }
  process.exit(EXIT_USAGE);
}

// ── state validation (before anything touches the tracker) ──────

let states;
try {
  states = loadCanonicalStates(STATES_FILE);
} catch (err) {
  failWith(EXIT_USAGE, 'states-error', `Cannot load canonical states from ${STATES_FILE}: ${err.message}`);
}
const newStatus = resolveCanonicalState(stateInput, states);
if (!newStatus) {
  const valid = states.map(s => s.label).join(' · ');
  failWith(EXIT_USAGE, 'invalid-state', `"${stateInput}" is not a canonical state. Valid states: ${valid}`);
}

// ── tracker access ───────────────────────────────────────────────

const APPS_FILE = resolveTrackerPath(CAREER_OPS);
if (!existsSync(APPS_FILE)) {
  failWith(EXIT_NOT_FOUND, 'no-tracker', `No tracker found at ${APPS_FILE}`);
}

/**
 * Reduce a selector's candidate list to exactly one row, or exit.
 *
 * Every selector path shares one shape: match, optionally narrow by --role,
 * refuse to guess between survivors, return the unique row. Only the predicate
 * and the two messages differ.
 *
 * Centralising it matters more than the duplication it removes. **Failing
 * closed on 2+ candidates is the #1704 fix** — a stale tracker # reused across
 * two rows makes "the first match" a silent coin flip on which company gets
 * edited. While that behaviour lived in three copies, a future change that
 * reintroduced first-match-wins in one branch would have been invisible in the
 * other two. There is now one place to get it wrong, and one place to test.
 *
 * Note --role only ever *narrows* here; it never validates a lone match. That
 * is deliberate and load-bearing: the #2009 check downstream compares the
 * resolved row against --role precisely because a selector matching exactly
 * one row never reaches the narrowing branch. Do not "fix" that by validating
 * here — the two checks answer different questions.
 *
 * @param {object[]} matches - Rows matching the selector, before --role narrowing.
 * @param {object} messages - Selector-specific failure text.
 * @param {string} messages.notFound - Message when nothing matched.
 * @param {(count: number, listing: string) => string} messages.ambiguous - Message when 2+ survive.
 * @returns {object} The single matched row. Exits the process on 0 or 2+ matches.
 */
function resolveCandidates(matches, { notFound, ambiguous }) {
  if (matches.length === 0) {
    failWith(EXIT_NOT_FOUND, 'not-found', notFound);
  }
  if (matches.length > 1 && flags.role) {
    const narrowed = matches.filter(r => roleFuzzyMatch(r.role, flags.role));
    if (narrowed.length === 1) return narrowed[0];
    // Fall through with the original list so the candidates stay visible.
  }
  if (matches.length > 1) {
    const candidates = matches.map(r => ({ num: r.num, company: r.company, role: r.role }));
    const listing = candidates.map(c => `#${c.num}\t${c.company}\t${c.role}`).join('\n');
    failWith(EXIT_AMBIGUOUS, 'ambiguous', ambiguous(matches.length, listing), { candidates });
  }
  return matches[0];
}

/**
 * Find the tracker row matching the CLI selector.
 *
 * @param {object[]} rows - Parsed data rows (parseTrackerRow output + lineIdx).
 * @returns {object} The single matched row. Exits the process on 0 or 2+ matches.
 */
function resolveRow(rows) {
  // --report N: resolve through the Report cell, which is the number space a
  // caller reading a report filename actually has in hand.
  if (flags.report !== null) {
    const num = parseInt(flags.report, 10);
    return resolveCandidates(
      rows.filter(r => extractTrackerReportNumbers(r.report, r.notes).includes(num)),
      {
        notFound: `No tracker row links report #${num}. (Report IDs and tracker row IDs differ — ` +
          'use --row N to select by tracker #.)',
        ambiguous: (count, listing) =>
          `Report #${num} is linked by ${count} tracker rows — pass --role to disambiguate:\n${listing}`,
      },
    );
  }

  // --row N and a bare numeric selector both match the # column; they differ
  // only in whether the mismatch guard below treats the number as ambiguous.
  if (flags.row !== null || isBareNumericSelector) {
    const num = parseInt(flags.row !== null ? flags.row : selector, 10);
    return resolveCandidates(
      rows.filter(r => r.num === num),
      {
        notFound: `No tracker row with #${num}`,
        // #1704: a stale tracker # reused across 2+ rows means "the first
        // match" is a silent coin flip on which company gets edited. Refuse to
        // guess; require --role or the company selector instead.
        ambiguous: (count, listing) =>
          `#${num} is a duplicate tracker number shared by ${count} rows (see #1704) — ` +
          `pass --role to disambiguate, or use the company name instead:\n${listing}`,
      },
    );
  }

  const key = normalizeCompany(selector);
  if (!key) failUsage(`Selector "${selector}" is empty after normalization`);
  return resolveCandidates(
    rows.filter(r => normalizeCompany(r.company) === key),
    {
      notFound: `No tracker row with company matching "${selector}"`,
      ambiguous: (count, listing) =>
        `Company "${selector}" matches ${count} rows — pass the # or narrow with --role:\n${listing}`,
    },
  );
}

// ── locked read-modify-write ─────────────────────────────────────

// Shared with mark-pdf-ready.mjs (tracker-utils.mjs): dry-run never writes,
// so it must not hold the exclusive lock — a read-only preview should not
// block (or be blocked by) merge-tracker or another writer.
const lock = await acquireTrackerLockForCli(APPS_FILE, { dryRun: flags.dryRun, failWith });

let content;
try {
  content = readFileSync(APPS_FILE, 'utf-8');
} catch (err) {
  failWith(EXIT_NOT_FOUND, 'read-failure', `Cannot read tracker at ${APPS_FILE}: ${err.message}`);
}
const lines = content.split('\n');
const colmap = resolveColumns(lines);

const rows = [];
for (let i = 0; i < lines.length; i++) {
  const row = parseTrackerRow(lines[i], colmap);
  if (row) rows.push({ ...row, lineIdx: i });
}
if (rows.length === 0) {
  failWith(EXIT_NOT_FOUND, 'empty-tracker', `Tracker at ${APPS_FILE} has no data rows`);
}

const target = resolveRow(rows);

// A BARE numeric selector is often copied from a report filename. If the row ID
// disagrees with its local report link, silently updating that row can affect
// the wrong application. Company selectors remain usable, and --force records an
// explicit decision to proceed despite the mismatch.
//
// --row/--report are exempt by construction, not by override: the caller has
// already said which number space they mean, so there is no ambiguity left to
// guard. That distinction is what keeps the check meaningful — on a tracker
// whose counters have diverged, a guard that fires on every numeric call just
// teaches callers to pass --force, which disables it everywhere including the
// cases it was written for.
if (isBareNumericSelector && !flags.force) {
  const reportNums = extractTrackerReportNumbers(target.report, target.notes);
  const mismatched = reportNums.filter(num => num !== target.num);
  if (mismatched.length > 0) {
    failWith(
      EXIT_AMBIGUOUS,
      'report-number-mismatch',
      `Tracker #${target.num} points to report ID(s) ${reportNums.map(num => `#${num}`).join(', ')}. ` +
        `Say which you meant: --row ${target.num} (tracker row) or ` +
        `--report ${reportNums[0]} (report ID). ` +
        'The company selector also works; --force overrides the check instead of answering it.',
      { trackerNum: target.num, reportNums },
    );
  }

  // The check above compares the matched row's report link against its own #.
  // A backfilled row (#1799) has no link, so reportNums is empty, `mismatched`
  // is empty, and the check passes with nothing compared — while a DIFFERENT
  // row may link exactly this number as its report.
  //
  // That combination is not hypothetical: it is what merge-tracker.mjs's
  // "Tracker #N already used; assigning #M" fallback produces. The backfilled
  // row occupying #N is what pushes the evaluated row to #M, so the row a stale
  // numeric selector lands on is precisely the report-less one this check could
  // not see. Bare "#N" then names two applications at once and must not write.
  if (reportNums.length === 0) {
    const num = parseInt(selector, 10);
    const linkers = rows.filter(r => r !== target && extractTrackerReportNumbers(r.report, r.notes).includes(num));
    if (linkers.length > 0) {
      const listing = linkers.map(r => `#${r.num}\t${r.company}\t${r.role}`).join('\n');
      failWith(
        EXIT_AMBIGUOUS,
        'report-number-ambiguous',
        `"${num}" is ambiguous: tracker row #${num} (${target.company} — ${target.role}) has no report, ` +
          `but report #${num} is linked by:\n${listing}\n` +
          `Say which you meant: --row ${num} (the row) or --report ${num} (the report).`,
        { trackerNum: target.num, reportNum: num, linkedBy: linkers.map(r => ({ num: r.num, company: r.company, role: r.role })) },
      );
    }
  }
}

// --role is an explicit statement of which opening the caller means, but
// resolveRow only consults it to break ties between 2+ candidates. A selector
// matching exactly one row therefore returned that row without ever checking
// it against --role, silently rewriting a status the caller never asked for.
// That is the wrong-row mutation in #2009: the intended requisition may not be
// in the tracker at all (fuzzy-deduped away, or never merged), so the lone
// survivor for that company absorbs the update instead. Fail closed and let
// --force record an explicit decision, matching the report-mismatch guard.
// Exact-title equality must be checked separately: roleFuzzyMatch is a DEDUP
// predicate, and it deliberately returns false for two titles whose overlap is
// entirely baseline vocabulary (["platform","engineer"]) so that same-titled
// sibling reqs never auto-merge. That makes it unusable on its own here — it
// would reject --role "Platform Engineer" against a row that IS exactly that.
// The collapse must drop PUNCTUATION, never letters. `[^a-z0-9]` dropped every
// letter outside the Latin range, so any title written entirely in Japanese,
// Arabic or Cyrillic keyed to '' — two different titles then compared equal
// ('' === '') and the guard wrote the status to a row it had never actually
// matched (#2670). normalizeTextKey is the Unicode-aware normalizer company
// matching already used; it also folds NFKC, so a decomposed title still
// matches its composed row.
const normalizeRoleText = s => normalizeTextKey(
  String(s ?? '')
    // NFKC first: normalizeTextKey folds it too, but only AFTER this pre-map, so
    // a fullwidth ＃/＋＋ would reach the collapse unrecognized and be stripped as
    // punctuation — "C＃ Engineer" and "C＋＋ Engineer" both keying to
    // "c engineer". Fullwidth forms are ordinary Japanese typography, so this is
    // the same shipped-market surface as the rest of #2670. Folding here also
    // makes the ASCII and fullwidth spellings of one title match each other.
    .normalize('NFKC')
    // Preserve symbols that distinguish real titles before collapsing generic
    // punctuation — otherwise "C# Engineer" and "C++ Engineer" both fold to
    // "c engineer" and the exact-equality path treats them as the same row.
    .replace(/\+\+/g, ' plusplus ')
    .replace(/#/g, ' sharp '),
  ' ',
);
const roleMatchesTarget = normalizeRoleText(target.role) === normalizeRoleText(flags.role)
  || roleFuzzyMatch(target.role, flags.role);

if (flags.role && !flags.force && !roleMatchesTarget) {
  failWith(
    EXIT_AMBIGUOUS,
    'role-mismatch',
    `Tracker #${target.num} (${target.company}) is "${target.role}", which does not match --role "${flags.role}". ` +
      'The row you meant may not be in the tracker. Re-run with --force to update this row anyway.',
    { trackerNum: target.num, rowRole: target.role, requestedRole: flags.role },
  );
}
const oldStatus = target.status;
const note = flags.note != null ? cell(flags.note) : null;

// Rebuild only the matched line: change the Status cell, append the note, keep
// every other cell exactly as parsed.
const parts = lines[target.lineIdx].split('|').map(s => s.trim());
while (parts.length <= Math.max(colmap.status, colmap.notes ?? 0)) parts.push('');

const statusChanged = parts[colmap.status] !== newStatus;
parts[colmap.status] = newStatus;

let noteChanged = false;
if (note) {
  if (colmap.notes == null) {
    failWith(EXIT_USAGE, 'no-notes-column', 'Tracker has no Notes column — cannot apply --note');
  }
  const existing = parts[colmap.notes] ?? '';
  // Delimiter-aware idempotency: the note counts as already present only when
  // it appears as a whole "; "-delimited entry (or as the entire field) — a
  // bare substring of a longer entry ("sent" inside "sent CV") must not
  // suppress a genuinely new note. Matching the full note text at entry
  // boundaries (instead of splitting the field into segments) keeps retries
  // idempotent even when the note itself contains "; ".
  const hasNote = existing === note
    || existing.startsWith(`${note}; `)
    || existing.endsWith(`; ${note}`)
    || existing.includes(`; ${note}; `);
  if (!hasNote) {
    parts[colmap.notes] = existing && existing !== '—' && existing !== '-' ? `${existing}; ${note}` : note;
    noteChanged = true;
  }
}

const changed = statusChanged || noteChanged;

if (changed && !flags.dryRun) {
  lines[target.lineIdx] = rebuildRow(parts);
  try {
    writeFileAtomic(APPS_FILE, lines.join('\n'));
  } catch (err) {
    // Same structured error contract as every other failure path — a raw
    // stack trace on stdout/stderr would break --json consumers.
    failWith(EXIT_USAGE, 'write-failure', `Cannot write tracker at ${APPS_FILE}: ${err.message}`);
  }
}

// ── status-log append (transition ledger, read by funnel-velocity.mjs) ──
// Observation trail only: the tracker stays the source of truth for STATE,
// the ledger records WHEN transitions happened. A failed append is a warning,
// never a failure — the status write above already succeeded. Sibling of the
// tracker file so CAREER_OPS_TRACKER redirects (tests, custom layouts) keep
// the ledger next to the tracker it describes. Inside the lock window, so
// concurrent writers can't interleave lines.
let statusLogged = false;
if (statusChanged && !flags.dryRun) {
  const logPath = join(dirname(APPS_FILE), 'status-log.tsv');
  // LOCAL today: the UTC day is TOMORROW for a west-of-Greenwich evening run,
  // so this appended a status-log row dated a day that had not happened yet
  // (#2932, mirroring #2765). status-log.tsv is what funnel-velocity reads for
  // time-between-stages, so a future-dated transition skews the interval it
  // measures rather than just looking odd in the file.
  const eventDate = flags.on ?? localToday();
  try {
    appendFileSync(logPath, `${target.num}\t${eventDate}\t${oldStatus}\t${newStatus}\t${flags.source ?? 'set-status'}\t\n`);
    statusLogged = true;
  } catch (err) {
    console.error(`⚠ status-log append failed (status change itself succeeded): ${err.message}`);
  }
}
lock?.release();

// ── follow-up seeding (#1430) ────────────────────────────────────
//
// The transition into Applied is where the first follow-up gets scheduled.
// set-status.mjs used to only ANNOUNCE that — `followupSeedCandidate: true` —
// and nothing consumed the flag: the only callers of followup-seed.mjs were
// modes/apply.md and modes/followup.md, both agent instructions. So recording
// an application from the web UI, or from this CLI directly, wrote the tracker
// and the ledger correctly and scheduled nothing, silently (#3459).
//
// Seeding HERE rather than in each caller is what makes that one fix instead of
// three: #2901 converged /api/status onto this script, so the web path inherits
// it, and so does every future caller that delegates here rather than editing
// the table.
//
// AFTER the tracker lock is released, deliberately. seedFollowup() re-reads the
// tracker to resolve the applied date, and it must read the row this run just
// wrote. It takes its own followups lock, never the tracker lock, so there is
// no lock ordering to get wrong.
//
// A seeding failure NEVER fails the status change. The write has already
// committed and the caller's exit code is about that write — same policy, and
// the same wording, as the status-log append above. It is also idempotent
// (`already-seeded` → seeded:false), so a re-run cannot stack duplicate pins.
let followupSeeded = null;
if (statusChanged && newStatus === 'Applied') {
  try {
    const { seedFollowup } = await import('./followup-seed.mjs');
    // followupsPath is derived from the tracker's own directory, not left to
    // followup-seed's default. Its default is the REPO's data/follow-ups.md,
    // so with CAREER_OPS_TRACKER pointing elsewhere — tests, and any install
    // whose data lives outside the checkout — the status would be written to
    // one tracker and the follow-up seeded next to a different one. The
    // status-log append above derives its path the same way.
    const seed = await seedFollowup(target.num, {
      trackerPath: APPS_FILE,
      followupsPath: join(dirname(APPS_FILE), 'follow-ups.md'),
      // --on is the day the transition REALLY happened, and for a transition
      // into Applied that day is the day the application was sent. Nothing
      // else carries it here: the tracker's date column is the evaluation
      // date and this script never rewrites it, so without passing it on,
      // seedFollowup falls back to that column or to today. Backdating a
      // week-old application would then schedule its first follow-up a week
      // late — from the wrong anchor, silently.
      date: flags.on,
      dryRun: flags.dryRun,
      // assumeApplied on a DRY RUN only, and deliberately not `force`.
      // seedFollowup refuses a row that is not Applied, and on a dry run the
      // tracker was not written — so the row it re-reads still holds the old
      // status and the preview would report a failure for the one thing the
      // real run is about to do. `force` would fix that by ALSO suppressing
      // the already-seeded check, which is the opposite of a preview: a row
      // that already has a pin would be promised a new one here and refused
      // on the real run. assumeApplied relaxes the status guard only. In a
      // real run the row IS Applied by this point and neither is needed.
      ...(flags.dryRun ? { assumeApplied: true } : {}),
    });
    followupSeeded = { seeded: seed.seeded, nextDate: seed.nextDate ?? null, ...(seed.reason ? { reason: seed.reason } : {}) };
    if (!flags.json && seed.seeded) {
      console.log(`📅 Follow-up ${flags.dryRun ? 'would be seeded' : 'seeded'} for #${target.num}: next ${seed.nextDate}`);
    }
  } catch (err) {
    followupSeeded = { seeded: false, reason: 'error', error: err.message };
    console.error(`⚠ follow-up seeding failed (status change itself succeeded): ${err.message}`);
  }
}

// ── report ───────────────────────────────────────────────────────

const result = {
  changed,
  num: target.num,
  company: target.company,
  role: target.role,
  oldStatus,
  newStatus,
  ...(note != null ? { note } : {}),
  ...(flags.dryRun ? { dryRun: true } : {}),
  // Fire the #1430 hook only on an actual transition INTO Applied — an
  // idempotent re-run of an already-Applied row must not invite a consumer
  // to seed a duplicate follow-up.
  // followupSeedCandidate is kept for any consumer already reading it; the
  // seeding it used to merely advertise now actually happens, and its outcome
  // travels beside it.
  ...(statusChanged && newStatus === 'Applied' ? { followupSeedCandidate: true } : {}),
  ...(followupSeeded ? { followupSeeded } : {}),
  ...(statusChanged && !flags.dryRun ? { statusLogged } : {}),
  tracker: APPS_FILE,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const verb = flags.dryRun ? 'would set' : changed ? 'set' : 'already';
  console.log(`✅ #${target.num} ${target.company} — ${target.role}: ${verb} ${oldStatus} → ${newStatus}${note ? ` (note: ${note})` : ''}`);
  // Only when seeding did NOT happen. The advisory predates the seeding above
  // and asked the user to do by hand what now runs for them; leaving it
  // unconditional would read as a contradiction right under "Follow-up seeded".
  if (statusChanged && !flags.dryRun && newStatus === 'Applied' && !followupSeeded?.seeded) {
    console.error('ℹ️  Status is Applied — consider seeding follow-ups in data/follow-ups.md (#1430: node followup-cadence.mjs)');
  }
}
process.exit(EXIT_OK);
