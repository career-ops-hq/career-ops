#!/usr/bin/env node
/**
 * followup-cadence.mjs — Follow-up Cadence Tracker for career-ops
 *
 * Parses applications.md + follow-ups.md, calculates follow-up cadence
 * for active applications, extracts contacts, and flags overdue entries.
 *
 * Run: node followup-cadence.mjs             (JSON to stdout)
 *      node followup-cadence.mjs --summary   (human-readable dashboard)
 *      node followup-cadence.mjs --overdue-only
 *      node followup-cadence.mjs --applied-days 10
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import { loadCanonicalStates, foldStatusInput } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { localToday } from './lib/local-today.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const FOLLOWUPS_FILE = join(CAREER_OPS, 'data/follow-ups.md');
const PROFILE_FILE = process.env.CAREER_OPS_PROFILE || join(CAREER_OPS, 'config/profile.yml');


// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const overdueOnly = args.includes('--overdue-only');
// flagValue (not indexOf) so `--applied-days=10` is honored too — indexOf()
// can't see the `=` form and used to silently discard it, falling back to the
// default cadence for a value the caller did supply (#2401/#2402 defect class).
const appliedDaysRaw = flagValue(args, '--applied-days');

// Whole-string match, not a bare parseInt: parseInt('1.5', 10) is 1 and
// parseInt('10days', 10) is 10 — both truncate a bad value into a plausible
// one instead of rejecting it, which is the exact silent-wrong-answer shape
// this file is being fixed to close. Exported so a value's actual numeric
// effect can be asserted directly, rather than only "the CLI didn't error".
const APPLIED_DAYS_RE = /^\d+$/;
export function parseAppliedDaysOverride(raw) {
  return raw !== undefined && APPLIED_DAYS_RE.test(raw) ? parseInt(raw, 10) : null;
}
const appliedDaysOverride = parseAppliedDaysOverride(appliedDaysRaw);

// --- Cadence config ---
export const DEFAULT_CADENCE = {
  applied_first: 7,
  applied_subsequent: 7,
  applied_max_followups: 2,
  responded_initial: 1,
  responded_subsequent: 3,
  interview_thankyou: 1,
};

const PROFILE_CADENCE_KEYS = {
  applied_first_days: 'applied_first',
  applied_subsequent_days: 'applied_subsequent',
  applied_max_followups: 'applied_max_followups',
  responded_initial_days: 'responded_initial',
  responded_subsequent_days: 'responded_subsequent',
  interview_thankyou_days: 'interview_thankyou',
};

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function loadProfileCadence(profilePath = PROFILE_FILE) {
  if (!profilePath || !existsSync(profilePath)) return {};
  let raw;
  try {
    raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    return {};
  }
  const source = raw.followup_cadence || {};
  const cadence = {};
  for (const [profileKey, cadenceKey] of Object.entries(PROFILE_CADENCE_KEYS)) {
    const parsed = positiveInteger(source[profileKey]);
    if (parsed !== null) cadence[cadenceKey] = parsed;
  }
  return cadence;
}

export function resolveCadenceConfig({ profilePath = PROFILE_FILE, appliedDays = appliedDaysOverride } = {}) {
  const cadence = { ...DEFAULT_CADENCE, ...loadProfileCadence(profilePath) };
  const cliApplied = positiveInteger(appliedDays);
  if (cliApplied !== null) cadence.applied_first = cliApplied;
  return cadence;
}

const CADENCE = resolveCadenceConfig();

// --- Status normalization ---
//
// DERIVED from templates/states.yml, not a hand-copy of it. The map that used
// to live here was already missing every Turkish spelling the Go dashboard
// recognises, so the same tracker row normalized three different ways: the TUI
// read `Mülakat` as `interview`, this file left it as `mülakat` (matching no
// ACTIONABLE/ADVANCED set, so the row silently vanished from the funnel), and
// the web rejected it outright on writeback. tracker-utils already exposes the
// loader for exactly this — its docstring says "a new state or alias lands in
// one file and every consumer follows" — it just had no consumer here (#2704).
//
// Cached per process: these are short-lived CLI runs, so a single read is
// correct. A long-running consumer must NOT copy this pattern — see #2590,
// where caching states.yml for a server's lifetime pinned a stale roster.
let aliasMapCache = null;

/** alias/id/label (lowercased) → canonical lowercase id, from states.yml. */
function statusAliasMap() {
  if (aliasMapCache) return aliasMapCache;
  const map = new Map();
  try {
    for (const st of loadCanonicalStates(join(CAREER_OPS, 'templates', 'states.yml'))) {
      const id = st.id.toLowerCase();
      map.set(foldStatusInput(id), id);
      if (st.label) map.set(foldStatusInput(st.label), id);
      for (const a of st.aliases) map.set(foldStatusInput(a), id);
    }
  } catch {
    // A missing/malformed states.yml is a broken install. Degrade to
    // identity-normalization rather than resurrecting a hardcoded table: a
    // fallback copy is the same copy in disguise and drifts the same way.
    return (aliasMapCache = new Map());
  }
  return (aliasMapCache = map);
}

const ACTIONABLE_STATUSES = ['applied', 'responded', 'interview'];

export function normalizeStatus(raw) {
  // foldStatusInput, not a bare toLowerCase: JS lowercases the Turkish dotted
  // capital `İ` to `i` + U+0307 and the mark survives, so every all-caps
  // Turkish row missed every alias (#2704 review).
  const clean = foldStatusInput(String(raw).replace(/\s+\d{4}-\d{2}-\d{2}.*$/, ''));
  return statusAliasMap().get(clean) || clean;
}

// --- Date helpers ---
function today() {
  // LOCAL calendar day, UTC midnight anchor. toISOString() gives the UTC DAY,
  // so west of Greenwich an evening run answered "today" with tomorrow and
  // every daysSinceApp came out one high — the follow-up came due a day early
  // (#3070). Same fix as followup-seed (#2765) and set-status (#2932).
  //
  // The arithmetic below is unchanged: parseDate() still anchors at UTC
  // midnight, so only WHICH day this is moves.
  return new Date(localToday());
}

export function parseDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  const s = dateStr.trim();
  const d = new Date(s);
  // Reject impossible calendar dates (2026-13-45, 2026-02-31): they match the
  // regex but produce an Invalid Date, which is TRUTHY — without this check it
  // slips through `if (!date)` guards and addDays().toISOString() throws,
  // killing the whole analysis over one bad row.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

// The tracker `date` column is often the evaluation date, while the real
// submission date is recorded in the notes as "Applied YYYY-MM-DD" (or
// "APPLIED ..."). Prefer that so cadence reflects when the application actually
// went out, not when the role was evaluated. Returns the first such date, or
// null when the notes don't carry one (caller falls back to the date column).
//
// The optional `~` accepts an estimated date ("Applied ~2026-06-09"), which is
// how an apply date reconstructed after the fact gets written. Skipping those
// silently fell back to the evaluation date — the exact wrong-age failure this
// lookup exists to prevent. The leading \b still refuses "reapplied".
//
// The trailing (?![\w-]) is the mirror of that leading \b: without it a
// malformed value ("2026-06-091", "2026-06-09-2026-06-10") is truncated to a
// plausible-looking date and then reported as a *measured* apply date. That is
// worse than no match at all — the evaluation-date fallback is at least labelled
// as inferred, whereas a truncated date is indistinguishable from a real one.
// Rejecting the bad candidate lets the scan continue to a later valid date.
//
// The token shape is necessary but not sufficient: "2026-06-31" and
// "2026-02-30" match it and are not real days.
//
// Whether that should be rejected here depends on the caller, so it is opt-in:
//   - followup-seed.mjs WANTS the raw candidate. It validates the date itself
//     and throws INVALID_DATE so a typo gets corrected rather than silently
//     absorbed — pinning a follow-up off a wrong date is worse than refusing.
//     Filtering here unconditionally would make that impossible date invisible
//     to it and turn a loud, fixable error into a silent wrong answer.
//   - the cadence report wants it skipped, because parseDate() rolls an
//     impossible date over (2026-06-31 becomes 2026-07-01), so it would become
//     a real but WRONG date labelled `notes` — i.e. measured, not inferred.
//     Falling back to the evaluation date is honest by comparison, and one bad
//     row must not fail a whole report.
//
// @param {string} notes
// @param {{requireValidCalendarDate?: boolean}} [options]
export function parseAppliedDate(notes, options = {}) {
  if (!notes) return null;
  const validateCalendar = options.requireValidCalendarDate === true;
  const text = String(notes);

  const matches = [];
  for (const m of text.matchAll(/\bapplied\s+~?(\d{4}-\d{2}-\d{2})(?![\w-])/gi)) {
    if (!validateCalendar || isRealCalendarDate(m[1])) matches.push({ date: m[1], index: m.index });
  }
  if (matches.length === 0) return null;

  // Drop dates that belong to a DIFFERENT row before choosing. Notes routinely
  // cite a sibling requisition's timeline for context — "#154 is already live
  // in the same ATS (applied 2026-08-04)" — and that citation reads exactly
  // like this row's own apply date to a positional scan (#2607).
  const own = matches.filter(m => !isCrossReferencedMention(text, m.index));

  // First-wins is preserved among a row's OWN dates: a later status date must
  // not displace the submission date (see the fixture in test-all.mjs).
  // Cross-reference filtering is orthogonal to that ordering rule.
  if (own.length > 0) return own[0].date;

  // Every apply-date in the note belongs to another row, so this note does not
  // state when THIS row was submitted. Returning null is the honest answer —
  // the alternative is reporting a real but foreign date as
  // `appDateSource: 'notes'`, i.e. measured, which is precisely the failure the
  // header comment warns about.
  //
  // Both consumers degrade to a LABELLED evaluation-date fallback:
  // resolveAppliedDate below reports `appDateSource: 'evaluation-date-fallback'`,
  // and followup-seed.mjs reports `appDateSource: 'evaluation-date'`. That was
  // not true when this was written — seed fell through to today(), unlabelled,
  // which made an old application look new and silently reset its follow-up
  // clock. #2607 changed seed's fallback so the claim below actually holds.
  return null;
}

// How far back to look for a row reference. Long enough to span a clause like
// "#154 Sr PM M&A is already live in the same ATS (applied ...)", short enough
// that an unrelated "#123" earlier in a long note does not reach forward and
// disqualify a genuine date.
const CROSS_REF_LOOKBACK = 120;

// A `#NNN` immediately preceded by a req/job/posting/reference label is an ATS
// identifier for THIS row, not a pointer at another tracker row. Anchored at the
// end so it only matches a label sitting directly before the `#`, and the
// separator excludes `.!?` so a sentence boundary cannot be swallowed into it.
// Same vocabulary as merge-tracker.mjs's REQ_NUMBER_RE, which reads the same
// Notes column.
const REQ_LABELLED_HASH_RE = /\b(?:job\s*id|posting\s*id|requisition|req|jr|job|posting|ref(?:erence)?)[\s:_-]*$/i;

/**
 * Whether the apply-date at `index` is being cited ABOUT ANOTHER ROW.
 *
 * Heuristic, and deliberately a narrow one: a `#NNN` row reference shortly
 * before the date, with no sentence boundary between them, means the date is
 * inside that reference's clause. A sentence break ends the reference's scope,
 * so "Sibling #140 was slow. Applied 2026-08-06." is correctly read as this
 * row's own date.
 *
 * A SEMICOLON OR PIPE IS A BOUNDARY ONLY ONCE THE REFERENCE HAS ITS OWN DATE.
 * These are the separators this Notes column actually uses, and they do two
 * different jobs depending on what came before:
 *
 *   "#154 Sr PM (applied 2026-08-04); applied 2026-06-15"
 *        the citation already carries its date, so the second one is a new
 *        subject — this row's own. Reading the whole note as #154's discards a
 *        real measured date, and this is the MORE common shape: two roles live
 *        at one employer, and the note naming the sibling is usually the same
 *        note that records this submission.
 *
 *   "#154 is already live; applied 2026-08-04"
 *        the citation has no date yet, so the one after the separator is still
 *        its own — a semicolon joins independent clauses within a sentence and
 *        the subject carries across it. Treating it as a break here adopts a
 *        foreign date and reports it as MEASURED.
 *
 * Where the reading is genuinely ambiguous the tie goes to "cross-referenced",
 * because the two errors are not symmetric — a false positive degrades to a
 * fallback that is LABELLED as not-measured, while a false negative reports
 * another row's date as this row's measured one.
 *
 * Both failure directions are survivable, which is why a heuristic is
 * acceptable here: a false positive degrades to the evaluation date, labelled
 * as a fallback by both consumers (see the note in parseAppliedDate), and a
 * false negative is just the pre-#2607 behaviour. Neither invents a date.
 *
 * @param {string} text
 * @param {number} index - offset of the "applied" match within `text`
 * @returns {boolean}
 */
function isCrossReferencedMention(text, index) {
  const window = text.slice(Math.max(0, index - CROSS_REF_LOOKBACK), index);
  let refEnd = -1;
  for (const m of window.matchAll(/#\d+\b/g)) {
    // A `#NNN` tagged as a req/job/posting/reference id is not a row reference:
    // "Req #1311 - applied 2026-08-06" is this row's own posting id followed by
    // this row's own date, and reading it as a cross-reference would discard a
    // genuine date. The label vocabulary is the one merge-tracker.mjs already
    // recognises in this same Notes column (REQ_NUMBER_RE), kept in sync by
    // being written the same way rather than imported — merge-tracker's regex
    // also captures the id itself, which is not wanted here.
    if (REQ_LABELLED_HASH_RE.test(window.slice(0, m.index))) continue;
    refEnd = m.index + m[0].length;
  }
  if (refEnd === -1) return false;

  const sinceRef = window.slice(refEnd);
  // A sentence break always ends the reference's scope.
  if (/[.!?]\s/.test(sinceRef)) return false;

  // A semicolon or pipe ends it too — but only once the reference has already
  // been GIVEN a date. Those are the separators this Notes column actually uses,
  // and they do two different jobs depending on what came before:
  //
  //   "#154 Sr PM (applied 2026-08-04); applied 2026-06-15"
  //        the citation already has its date, so the second one is a new
  //        subject: this row's own. Reading the whole note as #154's loses a
  //        real measured date, and that is the more common shape — two roles
  //        live at one employer, and the note naming the sibling is usually the
  //        same note recording this submission.
  //
  //   "#154 is already live; applied 2026-08-04"
  //        the citation has NO date yet, so the one after the semicolon is
  //        still its own: a semicolon joins independent clauses within a
  //        sentence and the subject carries across it. Treating it as a break
  //        here adopts a foreign date and reports it as MEASURED, which is the
  //        failure this whole function exists to prevent.
  //
  // "Has the reference already been satisfied?" is what separates them, and it
  // is checked against the text before the LAST separator so a date belonging
  // to the citation cannot be read as belonging to a later clause.
  //
  // No trailing-whitespace requirement, unlike the sentence rule above. A full
  // stop needs one to avoid firing on "3.5" or "e.g.", but `;` and `|` do not
  // appear inside numbers or abbreviations, and a hand-typed note writes
  // ";applied 2026-06-15" as readily as "; applied 2026-06-15".
  const lastSeparator = [...sinceRef.matchAll(/[;|]/g)].pop();
  if (lastSeparator) {
    const beforeSeparator = sinceRef.slice(0, lastSeparator.index);
    if (/\bapplied\s+~?\d{4}-\d{2}-\d{2}/i.test(beforeSeparator)) return false;
  }
  return true;
}

// True only when YYYY-MM-DD names a day that exists. Round-tripping through a
// UTC Date and comparing the parts back catches out-of-range months/days as
// well as month-length and leap-year violations, which a range check misses.
export function isRealCalendarDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ''))) return false;
  const [y, mo, d] = iso.split('-').map(Number);
  if (mo < 1 || mo > 12 || d < 1) return false;
  // setUTCFullYear rather than Date.UTC: Date.UTC maps years 0-99 onto
  // 1900-1999, which would reject a literal ISO year below 0100 (0096-02-29 is
  // a real leap day). The absolute setter keeps the year as written.
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Which date the cadence is measured from, and where it came from. A caller
// cannot otherwise tell a real application date from the evaluation-date proxy,
// so an inferred age reads exactly like a measured one — and acting on that
// silently-wrong number is what pushes a live application into "cold".
export function resolveAppliedDate(app) {
  // requireValidCalendarDate: an impossible date in the notes must degrade to
  // the labelled fallback rather than be reported as a measured date. One bad
  // row must not fail the whole report, so this skips rather than throws —
  // unlike followup-seed.mjs, which refuses to pin a follow-up off a bad date.
  const fromNotes = parseAppliedDate(app?.notes, { requireValidCalendarDate: true });
  return fromNotes
    ? { appliedDate: fromNotes, appDateSource: 'notes' }
    : { appliedDate: app?.date ?? null, appDateSource: 'evaluation-date-fallback' };
}

export function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function addDays(date, days) {
  // Null-safe: parseDate() returns null for unparseable/impossible dates —
  // degrade to "no scheduled date" instead of crashing (new Date(null) would
  // silently be the 1970 epoch).
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().split('T')[0];
}

// --- Parse applications.md ---
// Content-based core so any consumer (stats.mjs, tests) can classify rows
// from in-memory strings without touching disk. The disk-backed wrapper
// below is what the CLI path uses.
function parseTrackerContent(content) {
  const lines = String(content ?? '').split('\n');
  const colmap = resolveColumns(lines);
  const entries = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) entries.push(row);
  }
  return entries;
}

// --- Parse follow-ups.md ---
// Two formats coexist in the log (both append-only):
//   1. Table rows:  | num | appNum | date | company | role | channel | contact | notes |
//   2. Legacy bullets written by early web builds: `- YYYY-MM-DD · #NUM Company — note`
// Bullets carry no channel/contact/role (mapped to Other/''/''), and bullets
// without a `#NUM` are skipped — they can't be attributed to an application.
// Pin-directive lines (`- next #...`) and the header/separator rows are also
// excluded — the header's `num` cell isn't numeric and the separator's dashes
// aren't either, so both fail the `isNaN` check below and never enter `entries`.
const BULLET_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+#(\d+)\s+(.+?)(?:\s+—\s+(.*))?$/;

export function parseFollowups(content) {
  const entries = [];
  for (const line of String(content ?? '').split('\n')) {
    if (line.startsWith('|')) {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 8) continue;
      const num = parseInt(parts[1]);
      if (isNaN(num)) continue;
      const appNum = parseInt(parts[2]);
      if (isNaN(appNum)) continue; // unattributable row would poison per-app grouping
      entries.push({
        num,
        appNum,
        date: parts[3],
        company: parts[4],
        role: parts[5],
        channel: parts[6],
        contact: parts[7],
        notes: parts[8] || '',
      });
      continue;
    }
    const m = line.match(BULLET_RE);
    if (!m) continue;
    entries.push({
      num: null,
      appNum: parseInt(m[2]),
      date: m[1],
      company: m[3],
      role: '',
      channel: 'Other',
      contact: '',
      notes: m[4] || '',
    });
  }
  return entries;
}

// `parseFollowups` is the disk-agnostic content parser upstream/main and its
// callers use internally (analyzeFromContent, external scripts); the branch's
// test-all.mjs imports it as `parseFollowupsContent`. Same function, two names.
export { parseFollowups as parseFollowupsContent };

// --- Next-date overrides (pins) ---
// A user can PIN an application's next follow-up date, taking precedence over
// the computed cadence (a pin even revives a cold application) until a
// follow-up logged on/after the pin's set-date resumes the normal schedule.
// Stored in data/follow-ups.md as directive lines:
//   - next #42 2026-07-10 (set 2026-07-02)
//   - next #42 2026-07-10 (set 2026-07-02) — why the date was pinned
// The `(set …)` part records when the pin was made; if omitted (hand-written)
// it defaults to the pinned date itself. The LAST pin line per application wins.
//
// A trailing `— note` is accepted and ignored. Pins are written by hand as
// often as by `followup-seed.mjs`, and a hand-written pin almost always wants
// to record WHY the date moved. Anchoring the pattern immediately after the
// `(set …)` group made every annotated pin fail to match — silently, since a
// non-matching line is indistinguishable from an ordinary bullet. The failure
// mode is the dangerous direction: the pin vanishes, the computed cadence
// takes over, and the application reports overdue when the user had
// explicitly deferred it.
const OVERRIDE_RE = /^-\s+next\s+#(\d+)\s+(\d{4}-\d{2}-\d{2})(?:\s+\(set\s+(\d{4}-\d{2}-\d{2})\))?(?:\s*[—–-].*)?\s*$/i;

export function parseNextOverrides(content) {
  const byApp = new Map();
  for (const line of content.split('\n')) {
    const m = line.match(OVERRIDE_RE);
    if (!m) continue;
    const date = m[2];
    if (!parseDate(date)) continue; // an impossible pinned date never poisons the analysis
    const appNum = parseInt(m[1]);
    byApp.set(appNum, { appNum, date, setDate: m[3] || date });
  }
  return byApp;
}

// The pin applies until a follow-up is logged AFTER it. Ties favor the pin:
// "log a follow-up, then pin the next date" is the common same-day flow.
export function resolveNextOverride(override, lastFollowupDate) {
  if (!override) return null;
  if (lastFollowupDate && lastFollowupDate > override.setDate) return null;
  return override.date;
}

// --- Retire directives ---
// Not every application has a reachable human behind it. A cold ATS submission
// with no contact on file has no follow-up channel at all, yet the cadence
// keeps reporting it overdue every week forever. A dashboard whose overdue
// count is mostly un-actionable rows trains the user to stop reading it, which
// costs far more than the rows themselves.
//
// A retire directive drops ONE application out of the cadence:
//   - cleared #42 2026-08-04 — no contact on file, no warm path
// The date records when the retirement was made. This closes the follow-up
// loop only — it does NOT close the application. The tracker row keeps its
// status and any inbound reply is still caught by reply-watch.
//
// Like a pin, a retirement is revoked by a follow-up logged after it, so
// re-engaging a retired application resumes its normal cadence with no
// bookkeeping. The LAST directive per application wins, and a retirement
// outranks a pin on the same application: retiring is the more explicit
// "stop surfacing this", and reviving it is a one-line edit either way.
const CLEARED_RE = /^-\s+cleared\s+#(\d+)\s+(\d{4}-\d{2}-\d{2})(?:\s*[—–-].*)?\s*$/i;

export function parseClearedDirectives(content) {
  const byApp = new Map();
  for (const line of String(content ?? '').split('\n')) {
    const m = line.match(CLEARED_RE);
    if (!m) continue;
    const setDate = m[2];
    if (!parseDate(setDate)) continue; // an impossible date never poisons the analysis
    const appNum = parseInt(m[1]);
    byApp.set(appNum, { appNum, setDate });
  }
  return byApp;
}

// Mirrors resolveNextOverride's revival rule, including the same-day tie:
// "log a final follow-up, then retire" is the common flow, so a follow-up
// dated the same day as the retirement does not undo it.
export function isRetired(cleared, lastFollowupDate) {
  if (!cleared) return false;
  if (lastFollowupDate && lastFollowupDate > cleared.setDate) return false;
  return true;
}

// --- Extract contacts from notes ---
// Outreach recorded in notes is usually a NAME, not an email — LinkedIn, the
// most common channel, never produces one. An email-only parser therefore
// reports `contacts: []` for rows that do have a human attached, and "no
// contact" becomes indistinguishable from "contact with no email on file".
// That inverts the meaning of the field: an empty list reads as "outreach is
// untried here" when outreach has in fact been tried and has not converted.
//
// Emitted shape is `{ name, email, channel }`. `email` stays first-class (and
// remains non-null for email contacts) so existing consumers keep working;
// `channel` is additive.
const EMAIL_RE = /[\w.-]+@[\w.-]+\.\w+/g;

// Name-shaped contacts are gated on an explicit outreach verb or role word, so
// a capitalized company name ("Acme Corp") can never be mistaken for a person.
// Both name parts allow an internal hyphen or apostrophe ("Mary-Jane
// O'Brien") — dropping such a name would report "no contact" for a row that
// plainly names a person, the very silence this parser exists to remove.
const OUTREACH_NAME_RE = /\b(?:recruiter|hiring manager|messaged|contacted|emailed|called|reached out to|spoke with|outreach)\b[\s(]*([A-Z][a-z]*(?:[-'’][A-Z]?[a-z]+)*(?:\s+[A-Z][a-z]*(?:[-'’][A-Z]?[a-z]+)*)+)/g;

// One note can record several separate outreach events ("Messaged X on
// LinkedIn; called Y"). Resolving a contact against the WHOLE note attributes
// the first channel word it finds to every contact, so the second person is
// silently credited to the wrong channel. Split into statements and resolve
// each independently.
//
// The sentence split only fires on a period followed by whitespace and a
// capital, so it cannot break an address like `jane.doe@acme.com`.
function splitStatements(notes) {
  return String(notes).split(/[;\n]+|\.\s+(?=[A-Z])/).filter(s => s.trim());
}

/**
 * The candidate's own addresses, so a note that mentions them is not reported as somebody to chase.
 *
 * Tracker notes routinely cite your own mailbox while recording where a search ran — e.g. "searched
 * both accounts (personal + me@work.example) for this thread" written to establish that a reply was
 * NOT received. extractContacts has no concept of self, so it reads that as a repliable human and
 * the row advertises a contact that cannot be written to. That is worse than reporting no contact:
 * it makes an un-chaseable row look actionable.
 *
 * Read from config/profile.yml rather than hardcoded, so it stays correct per profile. Fails open —
 * an absent or unreadable profile yields an empty set, because a missing profile must never start
 * deleting real contacts.
 */
export function loadSelfIdentities(profilePath = PROFILE_FILE) {
  if (!profilePath || !existsSync(profilePath)) return new Set();
  let raw;
  try {
    raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    return new Set();
  }
  const out = new Set();
  const push = (v) => { if (typeof v === 'string' && v.includes('@')) out.add(v.trim().toLowerCase()); };
  push(raw.candidate?.email);
  // Only iterate an actual array. A hand-edited profile can reasonably hold a mapping here
  // (`alternate_emails: { work: me@example.com }`), and `for...of` on an object throws — at module
  // load, because SELF_IDENTITIES is initialised at import time. That would take followup-cadence
  // down entirely over a cosmetic config mistake, which is the opposite of the fail-open behaviour
  // this function promises everywhere else.
  const alternates = raw.candidate?.alternate_emails;
  if (Array.isArray(alternates)) for (const alt of alternates) push(alt);
  return out;
}

const SELF_IDENTITIES = loadSelfIdentities();

export function extractContacts(notes, selfIdentities = SELF_IDENTITIES) {
  if (!notes) return [];
  const byEmail = new Map();  // normalized email -> contact
  const byName = new Map();   // normalized name  -> contact
  const contacts = [];

  const add = ({ name, email, channel }) => {
    const emailKey = email ? email.toLowerCase() : null;
    const nameKey = name ? name.toLowerCase() : null;

    // Same address recorded twice is one contact; fill in a name/channel the
    // earlier mention lacked rather than emitting a duplicate.
    const byEmailHit = emailKey ? byEmail.get(emailKey) : null;
    const byNameHit = nameKey ? byName.get(nameKey) : null;

    // A name-only and an email-only record can be created separately, then a
    // later statement names BOTH and proves they are the same person. Fold the
    // two records into one and drop the redundant entry, or the result reports
    // two contacts where the note itself says there is one.
    if (byEmailHit && byNameHit && byEmailHit !== byNameHit) {
      byEmailHit.name = byEmailHit.name || byNameHit.name;
      byEmailHit.email = byEmailHit.email || byNameHit.email;
      byEmailHit.channel = byEmailHit.channel || byNameHit.channel;
      const idx = contacts.indexOf(byNameHit);
      if (idx !== -1) contacts.splice(idx, 1);
      // Repoint every key that pointed at the discarded record.
      for (const [k, v] of byEmail) if (v === byNameHit) byEmail.set(k, byEmailHit);
      for (const [k, v] of byName) if (v === byNameHit) byName.set(k, byEmailHit);
    }

    const existing = byEmailHit || byNameHit || null;
    if (existing) {
      if (!existing.name && name) existing.name = name;
      if (!existing.email && email) existing.email = email;
      if (!existing.channel && channel) existing.channel = channel;
      if (existing.email) byEmail.set(existing.email.toLowerCase(), existing);
      if (existing.name) byName.set(existing.name.toLowerCase(), existing);
      return;
    }

    const contact = { name: name ?? null, email: email ?? null, channel: channel ?? null };
    contacts.push(contact);
    if (emailKey) byEmail.set(emailKey, contact);
    if (nameKey) byName.set(nameKey, contact);
  };

  for (const span of splitStatements(notes)) {
    const emails = span.match(EMAIL_RE) || [];
    const names = [...span.matchAll(OUTREACH_NAME_RE)].map(m => m[1].trim());
    if (!emails.length && !names.length) continue;
    const channel = detectChannel(span, emails.length > 0);

    // One person and one address in the same statement is one contact, not an
    // email-only entry plus a separate name-only duplicate.
    if (names.length === 1 && emails.length === 1) {
      add({ name: names[0], email: emails[0], channel });
      continue;
    }

    for (const email of emails) {
      // Fall back to the older "Emailed Name at <addr>" shape for a name that
      // sits next to the address without a listed outreach verb.
      let name = null;
      const beforeEmail = span.substring(0, span.indexOf(email));
      const nameMatch = beforeEmail.match(/(?:emailed|contact[:\s]+|to\s+)([A-Z][a-z]+ ?[A-Z]?[a-z]*)\s*(?:at|@|$)/i);
      if (nameMatch) name = nameMatch[1].trim();
      add({ name, email, channel });
    }
    for (const name of names) add({ name, email: null, channel });
  }

  // A note citing your own mailbox is not a person to follow up with.
  return contacts.filter((c) => !(c.email && selfIdentities.has(c.email.toLowerCase())));
}

// The channel a single statement names, when it names one. Null rather than a
// guess: an unspecified channel is not evidence of any particular one. An
// address in the statement implies email only when no channel word says otherwise.
function detectChannel(span, hasEmail = false) {
  if (/\blinkedin\b/i.test(span)) return 'linkedin';
  if (/\bphone\b|\bcalled\b/i.test(span)) return 'phone';
  if (/\bemail(ed)?\b/i.test(span) || hasEmail) return 'email';
  return null;
}

// Display label for a contact: the email when there is one, otherwise the name.
// The summary table reads this instead of `.email` directly, so a name-only
// contact shows the person rather than a literal "null".
export function contactLabel(contact) {
  if (!contact) return '-';
  return contact.email || contact.name || '-';
}

// --- Resolve report path ---
export function resolveReportPath(reportField, appsFile = APPS_FILE, repoRoot = CAREER_OPS) {
  const match = reportField.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  // Report links in the tracker are normalized relative to the tracker file's
  // own directory (see PR #760 — `merge-tracker.mjs --migrate`). Resolve against
  // dirname(APPS_FILE), not the project root, otherwise relative paths like
  // `../reports/...` (the data/applications.md layout) escape above the project.
  const fullPath = join(dirname(appsFile), match[1]);
  const repoRelative = relative(repoRoot, fullPath).split(sep).join('/');
  if (repoRelative.startsWith('../') || repoRelative === '..' || !repoRelative.startsWith('reports/')) return null;
  return existsSync(fullPath) ? repoRelative : null;
}

// --- Compute urgency ---
// For responded/interview, logged follow-ups CLEAR the overdue state and the
// clock restarts from the last touch (re-overdue every responded_subsequent
// days) — matching the cadence table in modes/followup.md ("Responded: every
// 3 days · Interview: thank-you, then every 3 days, no limit").
export function computeUrgency(status, daysSinceApp, daysSinceLastFollowup, followupCount) {
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return 'cold';
    if (followupCount === 0 && daysSinceApp >= CADENCE.applied_first) return 'overdue';
    if (followupCount > 0 && daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.applied_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'responded') {
    if (daysSinceLastFollowup !== null) {
      return daysSinceLastFollowup >= CADENCE.responded_subsequent ? 'overdue' : 'waiting';
    }
    if (daysSinceApp < CADENCE.responded_initial) return 'urgent';
    if (daysSinceApp >= CADENCE.responded_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'interview') {
    if (daysSinceLastFollowup !== null) {
      return daysSinceLastFollowup >= CADENCE.responded_subsequent ? 'overdue' : 'waiting';
    }
    return daysSinceApp >= CADENCE.interview_thankyou ? 'overdue' : 'waiting';
  }
  return 'waiting';
}

// --- Compute next follow-up date ---
export function computeNextFollowupDate(status, appDate, lastFollowupDate, followupCount) {
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return null; // cold
    if (followupCount === 0) return addDays(parseDate(appDate), CADENCE.applied_first);
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.applied_subsequent);
    return addDays(parseDate(appDate), CADENCE.applied_first);
  }
  if (status === 'responded') {
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.responded_subsequent);
    return addDays(parseDate(appDate), CADENCE.responded_initial);
  }
  if (status === 'interview') {
    // After the thank-you is logged, subsequent touches follow the responded
    // cadence (modes/followup.md: "Every 3 days · No limit").
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.responded_subsequent);
    return addDays(parseDate(appDate), CADENCE.interview_thankyou);
  }
  return null;
}

// --- Main analysis ---
// Content-based core so consumers outside this CLI (stats.mjs, tests) can
// reuse the exact same cadence/urgency math — including the 'cold'
// classification — without duplicating it or touching disk. `followupsContent`
// missing/empty (the common case when data/follow-ups.md doesn't exist yet)
// degrades gracefully: every app gets followupCount 0, so 'cold' (which
// requires followupCount >= applied_max_followups) simply never triggers —
// no error, no guessing, matching the same "absent optional file = pass
// through" convention used elsewhere in this project.
export function analyzeFromContent(trackerContent, followupsContent = '') {
  const apps = parseTrackerContent(trackerContent);
  if (apps.length === 0) {
    return { error: 'No applications found in tracker.' };
  }

  const followups = parseFollowups(followupsContent);
  const overrides = parseNextOverrides(String(followupsContent ?? ''));
  const cleared = parseClearedDirectives(followupsContent);

  // Group follow-ups by app number
  const followupsByApp = new Map();
  for (const fu of followups) {
    if (!followupsByApp.has(fu.appNum)) followupsByApp.set(fu.appNum, []);
    followupsByApp.get(fu.appNum).push(fu);
  }

  const now = today();
  const entries = [];

  for (const app of apps) {
    const normalized = normalizeStatus(app.status);
    if (!ACTIONABLE_STATUSES.includes(normalized)) continue;

    // Prefer the "Applied YYYY-MM-DD" date from notes; fall back to the column.
    // appDateSource travels with the entry so a consumer can tell a measured
    // age from one inferred off the evaluation date.
    const { appliedDate, appDateSource } = resolveAppliedDate(app);
    const appDate = parseDate(appliedDate);
    if (!appDate) continue;

    const daysSinceApp = daysBetween(appDate, now);
    const appFollowups = followupsByApp.get(app.num) || [];
    const followupCount = appFollowups.length;

    // Find most recent follow-up (sorted date-desc; also exposed per entry so
    // the web dashboard can render history without a second parser).
    let lastFollowupDate = null;
    let daysSinceLastFollowup = null;
    const sortedFollowups = [...appFollowups].sort((a, b) => (a.date > b.date ? -1 : 1));
    if (sortedFollowups.length > 0) {
      lastFollowupDate = sortedFollowups[0].date;
      const lastDate = parseDate(lastFollowupDate);
      if (lastDate) daysSinceLastFollowup = daysBetween(lastDate, now);
    }

    let urgency = computeUrgency(normalized, daysSinceApp, daysSinceLastFollowup, followupCount);
    let nextFollowupDate = computeNextFollowupDate(normalized, appliedDate, lastFollowupDate, followupCount);

    // A pinned next-date takes precedence over the computed cadence (explicit
    // user intent — it even revives a cold application) until a follow-up
    // logged after the pin resumes the normal schedule.
    const nextOverride = resolveNextOverride(overrides.get(app.num), lastFollowupDate);
    if (nextOverride) {
      nextFollowupDate = nextOverride;
      urgency = daysBetween(parseDate(nextOverride), now) >= 0 ? 'overdue' : 'waiting';
    }

    // A retirement outranks a pin: it means "there is no channel here", which
    // no computed or pinned date can make true.
    const retired = isRetired(cleared.get(app.num), lastFollowupDate);
    if (retired) {
      urgency = 'retired';
      nextFollowupDate = null;
    }

    const nextDate = nextFollowupDate ? parseDate(nextFollowupDate) : null;
    const daysUntilNext = nextDate ? daysBetween(now, nextDate) : null;

    const contacts = extractContacts(app.notes);
    const reportPath = resolveReportPath(app.report);

    entries.push({
      num: app.num,
      date: app.date,
      appliedDate,
      appDateSource,
      company: app.company,
      // Intermediary channel (#1596): agency name when the application went
      // through an intermediary, null for a direct application (the tracker's
      // `—` placeholder and the no-Via-column case both normalize to null, so
      // consumers never learn the sentinel). When set, follow-ups chase the
      // agency contact, not the company.
      via: app.via && app.via !== '—' ? app.via : null,
      role: app.role,
      status: normalized,
      score: app.score,
      notes: app.notes,
      reportPath,
      contacts,
      daysSinceApplication: daysSinceApp,
      daysSinceLastFollowup,
      followupCount,
      followups: sortedFollowups,
      urgency,
      nextFollowupDate,
      nextOverride,
      daysUntilNext,
    });
  }

  // Sort by urgency priority: urgent > overdue > waiting > cold
  const urgencyOrder = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };
  entries.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  // Retired applications are counted but not listed — surfacing them in the
  // entries array would defeat the point of retiring them, and the count keeps
  // the retirement visible enough to be reconsidered.
  const retiredCount = entries.filter(e => e.urgency === 'retired').length;
  const active = entries.filter(e => e.urgency !== 'retired');

  const filtered = overdueOnly
    ? active.filter(e => e.urgency === 'overdue' || e.urgency === 'urgent')
    : active;

  return {
    metadata: {
      analysisDate: now.toISOString().split('T')[0],
      totalTracked: apps.length,
      actionable: active.length,
      overdue: active.filter(e => e.urgency === 'overdue').length,
      urgent: active.filter(e => e.urgency === 'urgent').length,
      cold: active.filter(e => e.urgency === 'cold').length,
      waiting: active.filter(e => e.urgency === 'waiting').length,
      retired: retiredCount,
    },
    entries: filtered,
    cadenceConfig: CADENCE,
    // The EFFECTIVE cadence above is defaults+profile overrides. Consumers that
    // need to show what a value would be WITHOUT the user's override (the web
    // settings form's placeholder) need the pure defaults too — sourcing that
    // placeholder from cadenceConfig would render a user's own override as the
    // default they'd be reverting to. Emitting both is what lets the web stop
    // hand-copying DEFAULT_CADENCE (#2369).
    cadenceDefaults: DEFAULT_CADENCE,
  };
}

// --- Main analysis (disk-backed CLI entry point) ---
function analyze() {
  const trackerContent = existsSync(APPS_FILE) ? readFileSync(APPS_FILE, 'utf-8') : '';
  const followupsContent = existsSync(FOLLOWUPS_FILE) ? readFileSync(FOLLOWUPS_FILE, 'utf-8') : '';
  return analyzeFromContent(trackerContent, followupsContent);
}

// --- Summary mode ---
function printSummary(result) {
  if (result.error) {
    console.log(`\n${result.error}\n`);
    return;
  }

  const { metadata, entries } = result;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Follow-up Cadence Dashboard — ${metadata.analysisDate}`);
  console.log(`  ${metadata.totalTracked} total applications, ${metadata.actionable} actionable`);
  console.log(`${'='.repeat(70)}\n`);

  if (entries.length === 0) {
    console.log('  No active applications to track. Apply to some roles first.\n');
    return;
  }

  // Status summary
  const urgencyIcon = { urgent: 'URGENT', overdue: 'OVERDUE', waiting: 'waiting', cold: 'COLD' };
  console.log(`  ${metadata.urgent} urgent | ${metadata.overdue} overdue | ${metadata.waiting} waiting | ${metadata.cold} cold\n`);

  // Table header
  console.log('  ' + '#'.padEnd(5) + 'Company'.padEnd(16) + 'Status'.padEnd(12) + 'Days'.padEnd(6) + 'F/U'.padEnd(5) + 'Next'.padEnd(13) + 'Urgency'.padEnd(10) + 'Contact');
  console.log('  ' + '-'.repeat(80));

  for (const e of entries) {
    const urgLabel = urgencyIcon[e.urgency] || e.urgency;
    const nextStr = e.nextFollowupDate || '-';
    const contactStr = e.contacts.length > 0 ? contactLabel(e.contacts[0]) : '-';
    console.log(
      '  ' +
      String(e.num).padEnd(5) +
      e.company.substring(0, 15).padEnd(16) +
      e.status.padEnd(12) +
      String(e.daysSinceApplication).padEnd(6) +
      String(e.followupCount).padEnd(5) +
      nextStr.padEnd(13) +
      urgLabel.padEnd(10) +
      contactStr
    );
  }

  console.log('');
}

// ── CLI flags + help ────────────────────────────────────────────────

const KNOWN_FLAGS = ['--summary', '--overdue-only', '--applied-days', '--help', '-h'];
const VALUE_FLAGS = ['--applied-days'];

const USAGE = `Usage:
  node followup-cadence.mjs                    # full JSON analysis to stdout
  node followup-cadence.mjs --summary          # human-readable dashboard
  node followup-cadence.mjs --overdue-only     # only show overdue/urgent entries
  node followup-cadence.mjs --applied-days 10  # override applied_first cadence (days)
  node followup-cadence.mjs --help|-h          # print this usage block and exit`;

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Must run inside this guard, not at module top level: CADENCE (above) is a
  // module-level singleton built at import time, and test-all.mjs section 12
  // dynamic-imports this module in-process to read it — validating the host
  // process's own argv there would false-positive on the test runner's flags.
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  // positiveInteger() (used to build CADENCE above) treats a NaN/negative value
  // as "absent" and silently keeps the default — exactly the wrong-answer-at-
  // exit-0 shape this fix exists to close. A value that was actually SUPPLIED
  // must fail loudly instead of being swallowed the same way a bad flag NAME
  // used to be.
  if (appliedDaysRaw !== undefined && !(Number.isFinite(appliedDaysOverride) && appliedDaysOverride >= 0)) {
    console.error(`Error: --applied-days requires a non-negative integer, got "${appliedDaysRaw}"`);
    process.exit(1);
  }

  const result = analyze();

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.error) process.exit(1);
}
