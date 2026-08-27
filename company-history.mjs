#!/usr/bin/env node
/**
 * company-history.mjs — Per-Company Evidence-Card Aggregator for career-ops
 *
 * READ-ONLY. Never writes a file. Joins the tracker (data/applications.md),
 * follow-ups (data/follow-ups.md), and scan-history (data/scan-history.tsv)
 * per company, and renders an evidence card per company covering two
 * independent axes:
 *
 *   - responsiveness: has THIS company ever responded to you, or gone silent
 *     on an Applied row past the silence window? A rejection counts as a
 *     response — it is an answer, not silence.
 *   - postingChurn: does this company repost the same role repeatedly
 *     (evergreen requisition / re-opened search), per detect-reposts.mjs?
 *     "The same role, later" is the whole claim: a company running several
 *     openings side by side — one per city, country, language or segment — is
 *     not reposting, and detect-reposts.mjs enforces that with a minimum span
 *     and a title-identity rule. Before it did, this axis reported
 *     `reposts-detected` for companies that had never reposted anything.
 *
 * This script deliberately reports FACTS, not verdicts. It never uses the
 * words "ghost"/"ghosted" or "risk" — high-volume inboxes, evergreen
 * requisitions, re-opened searches, and the candidate's own unlogged
 * responses all produce the same raw signals as genuine silence, so the
 * card lists evidence and lets the human judge it.
 *
 * Sources (each optional; a missing file degrades gracefully, never crashes):
 *   - tracker:       resolveTrackerPath() -> data/applications.md
 *   - follow-ups:    data/follow-ups.md
 *   - scan-history:  data/scan-history.tsv (-> detectReposts clusters)
 *   - status-log:    ./funnel-velocity.mjs, loaded ONLY via a dynamic
 *                     `await import(...)` in try/catch. The module ships on
 *                     main, but the optional applied-date/median helpers this
 *                     hook probes for are not part of its export surface, so
 *                     the statusLog source still reports false. The try-path is
 *                     written defensively so it degrades the same way whether
 *                     the module is absent OR present-but-shaped differently
 *                     than expected: every extraction from it is guarded by
 *                     `typeof x === 'function'`.
 *
 * Run: node company-history.mjs                    (JSON to stdout)
 *      node company-history.mjs --summary           (human-readable cards)
 *      node company-history.mjs --company "Acme"    (single-card lookup)
 *      node company-history.mjs --silence-window 21 (override default window)
 *      node company-history.mjs --include-stale     (include >365d-old facts in labels)
 *      node company-history.mjs --self-test
 */

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';

import { parseScanHistory, detectReposts, loadAggregatorCompanies, isKeyLookup } from './detect-reposts.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { normalizeCompany, resolveTrackerPath } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { localToday } from './lib/local-today.mjs';
import {
  parseFollowups,
  parseAppliedDate,
  parseDate,
  daysBetween,
  addDays,
  normalizeStatus,
} from './followup-cadence.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = process.env.CAREER_OPS_PROFILE || join(CAREER_OPS, 'config/profile.yml');
const PACKAGE_JSON = join(CAREER_OPS, 'package.json');

const DEFAULT_STALE_AFTER_DAYS = 365;
const DEFAULT_SILENCE_WINDOW_DAYS = 28;

// Statuses that count as "the company answered" — a rejection IS an answer, and
// a hire is the strongest answer of all (omitting it once labelled a company
// that hired you 'no-history', or 'silent-on-you' against other quiet rows).
const RESPONDED_STATUSES = new Set(['responded', 'interview', 'offer', 'hired', 'rejected']);
const OUTCOME_LABELS = { responded: 'Responded', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };

const EXPLANATION_LINE =
  'high-volume inboxes, evergreen requisitions, re-opened searches, and your own unlogged responses ' +
  'all produce these patterns — facts, not verdicts';

// Why the churn axis is empty here. Without this the card would look like a
// company that was checked and came back clean, which is a different claim.
const AGGREGATOR_LINE =
  'marked `aggregator: true` in portals.yml — a multi-employer board, so the same title is a ' +
  'different employer\'s job; posting churn was not evaluated for this company, not found absent';

// Locale-independent company ordering. A bare String.localeCompare() sorts by
// the host's default locale, so emitted ordering could differ between machines;
// pin the collator to 'en' so the output is byte-for-byte deterministic
// everywhere. Reused by both the JSON card ordering and the summary tiebreaker.
const companyCollator = new Intl.Collator('en');
const compareCompany = (a, b) => companyCollator.compare(String(a), String(b));

// --- CLI args ---
const KNOWN_FLAGS = ['--summary', '--self-test', '--company', '--silence-window', '--include-stale', '--scan-history', '--followups', '--emit-signal', '--help', '-h'];
const VALUE_FLAGS = ['--company', '--silence-window', '--scan-history', '--followups'];

const USAGE = `Usage:
  node company-history.mjs                       # full JSON evidence cards to stdout
  node company-history.mjs --summary              # human-readable cards
  node company-history.mjs --company "Acme"       # single-card lookup
  node company-history.mjs --silence-window 21    # override the default silence window (days)
  node company-history.mjs --include-stale        # include facts older than 365d in label computation
  node company-history.mjs --self-test            # run the in-memory test suite
  node company-history.mjs --summary --emit-signal  # human-readable cards, then RFC #1506 schema-v1 no-response-friction
                                                   # records as JSON Lines (one record per line) on stdout. --emit-signal
                                                   # REQUIRES --summary: without it, default/--company mode already prints
                                                   # a single parsable JSON document, and appending JSON Lines after it
                                                   # would make stdout un-parsable as one JSON value. --summary's output is
                                                   # not JSON to begin with, so appending JSON Lines after it stays clean —
                                                   # bare --emit-signal (no --summary) exits 1 with this same explanation.
  node company-history.mjs --help                 # print this usage block and exit`;

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // A value flag's space-separated value must not be mistaken for an
  // unrecognized flag just because it starts with `-` (mirrors
  // scan-ats-full.mjs's adjacency rule).
  const consumedValueIndices = new Set();
  args.forEach((a, idx) => {
    if (VALUE_FLAGS.includes(a) && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) {
      consumedValueIndices.add(idx + 1);
    }
  });

  const unknownFlags = args.filter((a, idx) =>
    a.startsWith('-') && !consumedValueIndices.has(idx) && !KNOWN_FLAGS.includes(a.split('=')[0]));
  if (unknownFlags.length) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${KNOWN_FLAGS.join(', ')}`);
    console.error(USAGE);
    process.exit(1);
  }

  const valueOf = (flag) => {
    // `--flag=value` form first: `args.indexOf(flag)` is -1 for it, so the
    // space-separated lookup below would silently drop the value otherwise.
    const eq = args.find(a => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  // A value-taking flag must actually receive a non-empty value: without this
  // guard `--company --summary` would consume `--summary` as the company name,
  // and `--company ""` / `--company=` would filter to a company that does not
  // exist. Reject the missing, the next-is-a-flag, and the empty-string cases in
  // both the space-separated (`--company ""`) and equals (`--company=`) forms.
  for (let idx = 0; idx < args.length; idx += 1) {
    const flag = args[idx];
    if (VALUE_FLAGS.includes(flag) && (args[idx + 1] === undefined || args[idx + 1] === '' || args[idx + 1].startsWith('--'))) {
      console.error(`Error: ${flag} expects a value.`);
      console.error(USAGE);
      process.exit(1);
    }
    if (VALUE_FLAGS.some(valueFlag => flag === `${valueFlag}=`)) {
      console.error(`Error: ${flag.slice(0, -1)} expects a non-empty value.`);
      console.error(USAGE);
      process.exit(1);
    }
  }

  // --silence-window must be a positive integer, validated before anything
  // runs: a NaN silently falling back to the default hides the user's typo,
  // and a zero/negative window would label every application silent.
  const silenceWindowArg = valueOf('--silence-window');
  if (silenceWindowArg !== undefined && !/^[1-9]\d*$/.test(silenceWindowArg)) {
    console.error(`Error: --silence-window expects a positive integer number of days, got "${silenceWindowArg}"`);
    console.error(USAGE);
    process.exit(1);
  }

  // --emit-signal is a bare boolean flag, not a value flag: the unknown-flag
  // check above strips a `--flag=value` suffix before matching against
  // KNOWN_FLAGS, so `--emit-signal=true` passes that check silently. But the
  // boolean read below is an exact-token `args.includes('--emit-signal')`,
  // which is false for `--emit-signal=true` — so the flag would be accepted
  // as "known" yet never actually turn signal emission on. Reject any `=`
  // form explicitly so a typo fails loudly instead of silently emitting
  // nothing.
  const emitSignalValue = args.find(a => a.startsWith('--emit-signal='));
  if (emitSignalValue) {
    console.error('Error: --emit-signal does not accept a value.');
    console.error(USAGE);
    process.exit(1);
  }

  const summaryMode = args.includes('--summary');
  const company = valueOf('--company');
  const emitSignal = args.includes('--emit-signal');

  // --emit-signal REQUIRES --summary (and is incompatible with --company).
  // Default mode and --company mode both print a single parsable JSON
  // document on stdout; appending JSON Lines signal records after that
  // document would make stdout un-parsable as one JSON value. --summary's
  // output is human-readable text, not JSON, so appending JSON Lines after it
  // is the one combination that stays clean — fail fast here rather than
  // silently corrupting a piped consumer's parse. `--company` wins over
  // `--summary` in the output-selection branch below (see the CLI run body),
  // so `--company --summary --emit-signal` would otherwise still print a bare
  // JSON object followed by JSON Lines; reject that combination too.
  if (emitSignal && (!summaryMode || company)) {
    console.error('Error: --emit-signal requires --summary and cannot be combined with --company (default and --company mode already print a single JSON document; appending JSON Lines after it would break JSON parsing of stdout). Use: node company-history.mjs --summary --emit-signal');
    console.error(USAGE);
    process.exit(1);
  }

  return {
    summaryMode,
    selfTestMode: args.includes('--self-test'),
    company,
    silenceWindowArg,
    includeStale: args.includes('--include-stale'),
    scanHistoryOverride: valueOf('--scan-history'),
    followupsOverride: valueOf('--followups'),
    emitSignal,
  };
}

// --- Default silence-window resolution ---
//
// templates/benchmarks.yml ships on main and a user install may also carry it
// (days_first_response.range_days[1] * 2). Try it, fall back to the hardcoded
// default. A missing file or any parse failure degrades silently to the default
// — this is a nice-to-have default source, never a hard dependency.
export function resolveDefaultSilenceWindow(rootDir = CAREER_OPS) {
  try {
    const path = join(rootDir, 'templates/benchmarks.yml');
    if (!existsSync(path)) return DEFAULT_SILENCE_WINDOW_DAYS;
    const doc = yaml.load(readFileSync(path, 'utf-8'));
    const range = doc?.days_first_response?.range_days;
    const upper = Array.isArray(range) ? range[1] : undefined;
    if (typeof upper === 'number' && Number.isFinite(upper) && upper > 0) return upper * 2;
    return DEFAULT_SILENCE_WINDOW_DAYS;
  } catch {
    return DEFAULT_SILENCE_WINDOW_DAYS;
  }
}

// --- today() — injectable for deterministic tests ---
export function today() {
  // LOCAL calendar day, UTC midnight anchor. toISOString() gives the UTC DAY,
  // so west of Greenwich an evening run answered "today" with tomorrow and
  // every age in the report came out one day high (#3070). Only WHICH day
  // this is moves; parseDate() still anchors at UTC midnight, so the
  // arithmetic downstream is unchanged.
  return new Date(localToday());
}

function resolveNow(now) {
  if (now instanceof Date) return now;
  if (typeof now === 'string') return parseDate(now) || today();
  return today();
}

// --- Source loaders (each returns {rows|clusters, loaded}; missing file -> empty + loaded:false) ---

export function loadTrackerRows(rootDir = CAREER_OPS) {
  const path = resolveTrackerPath(rootDir);
  if (!existsSync(path)) return { rows: [], loaded: false };
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push(row);
  }
  return { rows, loaded: true };
}

export function loadFollowupRows(rootDir = CAREER_OPS, overridePath) {
  const path = overridePath || join(rootDir, 'data/follow-ups.md');
  if (!existsSync(path)) return { rows: [], loaded: false };
  return { rows: parseFollowups(readFileSync(path, 'utf-8')), loaded: true };
}

// Returns the clusters plus the aggregator key Set, because the card needs both:
// the clusters to report, and the Set to explain why a given company has none.
// Without the Set an aggregator would render as `none-detected`, which claims a
// negative result from a check that never ran.
export function loadRepostClusters(rootDir = CAREER_OPS, overridePath, portalsPath) {
  const path = overridePath || join(rootDir, 'data/scan-history.tsv');
  // Same override scan.mjs and detect-reposts.mjs honour, so a sandboxed run
  // points all three at one config instead of silently reading the real one.
  const aggregators = loadAggregatorCompanies(
    portalsPath || process.env.CAREER_OPS_PORTALS || join(rootDir, 'portals.yml'),
  );
  if (!existsSync(path)) return { clusters: [], aggregators, loaded: false };
  const rows = parseScanHistory(readFileSync(path, 'utf-8'));
  return { clusters: detectReposts(rows, undefined, undefined, aggregators), aggregators, loaded: true };
}

// Dynamic-only dependency: funnel-velocity.mjs ships on main, but the
// applied-date/median helpers probed below are not part of its export surface.
// Loaded exclusively through a try/catch'd dynamic import so a missing (or
// differently-shaped) module never crashes this script. Every extraction
// below is guarded with typeof checks for the same reason — the module may be
// absent in a bare install, or present but without these optional helpers.
export async function loadStatusLogSource() {
  let mod = null;
  try {
    mod = await import('./funnel-velocity.mjs');
  } catch {
    return { loaded: false, appliedDateByNum: new Map(), medianResponseDays: null };
  }
  if (!mod || typeof mod !== 'object') {
    return { loaded: false, appliedDateByNum: new Map(), medianResponseDays: null };
  }

  // `loaded` reports whether this source can actually PRODUCE data, not merely
  // whether the import resolved. The merged funnel-velocity.mjs exports neither
  // optional helper, so when no usable helper is present the source is inert and
  // must report absent — otherwise callers treat empty enrichment as loaded.
  const hasAppliedHelper = typeof mod.getAppliedDateObservations === 'function';
  const hasMedianHelper = typeof mod.computeMedianResponseDays === 'function';
  if (!hasAppliedHelper && !hasMedianHelper) {
    return { loaded: false, appliedDateByNum: new Map(), medianResponseDays: null };
  }

  const appliedDateByNum = new Map();
  try {
    if (hasAppliedHelper) {
      const observations = mod.getAppliedDateObservations();
      if (Array.isArray(observations)) {
        for (const obs of observations) {
          if (obs && Number.isFinite(obs.num) && obs.appliedDate) {
            appliedDateByNum.set(obs.num, obs.appliedDate);
          }
        }
      }
    }
  } catch {
    // Defensive: an unexpected shape must not crash aggregation.
  }

  let medianResponseDays = null;
  try {
    if (hasMedianHelper) {
      const value = mod.computeMedianResponseDays();
      if (typeof value === 'number' && Number.isFinite(value)) medianResponseDays = value;
    }
  } catch {
    // Defensive: an unexpected shape must not crash aggregation.
  }

  return { loaded: true, appliedDateByNum, medianResponseDays };
}

// --- Follow-up counts joined by appNum ---
export function buildFollowupCountsByAppNum(followupRows) {
  const counts = new Map();
  for (const fu of Array.isArray(followupRows) ? followupRows : []) {
    if (!fu || !Number.isFinite(fu.appNum)) continue;
    counts.set(fu.appNum, (counts.get(fu.appNum) || 0) + 1);
  }
  return counts;
}

// --- Applied-date resolution (priority: status-log -> notes -> tracker date column) ---
export function resolveAppliedDate(row, statusLogAppliedByNum) {
  const fromLog = statusLogAppliedByNum instanceof Map ? statusLogAppliedByNum.get(row.num) : undefined;
  // Only let a status-log date take precedence when it actually parses —
  // otherwise one malformed optional observation would erase valid
  // notes/tracker evidence (computeResponsiveness skips unparsable dates).
  if (fromLog && parseDate(fromLog)) return { dateStr: fromLog, dateBasis: 'status-log' };

  const fromNotes = parseAppliedDate(row.notes);
  if (fromNotes) return { dateStr: fromNotes, dateBasis: 'notes' };

  return { dateStr: row.date, dateBasis: 'evaluation-date' };
}

// --- Responsiveness axis (pure) ---
//
// rows: tracker rows already scoped to one company.
// followupCountsByAppNum: Map<appNum, count> (global — join key is appNum, not company).
// opts: { now, silenceWindowDays, staleAfterDays, includeStale, statusLogAppliedByNum }
export function computeResponsiveness(rows, followupCountsByAppNum, opts = {}) {
  const now = resolveNow(opts.now);
  const silenceWindowDays = Number.isFinite(opts.silenceWindowDays) ? opts.silenceWindowDays : DEFAULT_SILENCE_WINDOW_DAYS;
  const staleAfterDays = Number.isFinite(opts.staleAfterDays) ? opts.staleAfterDays : DEFAULT_STALE_AFTER_DAYS;
  const includeStale = !!opts.includeStale;
  const counts = followupCountsByAppNum instanceof Map ? followupCountsByAppNum : new Map();
  const statusLogAppliedByNum = opts.statusLogAppliedByNum instanceof Map ? opts.statusLogAppliedByNum : null;

  const facts = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const normalized = normalizeStatus(String(row.status || ''));

    if (normalized === 'applied') {
      const { dateStr, dateBasis } = resolveAppliedDate(row, statusLogAppliedByNum);
      const appliedDate = parseDate(dateStr);
      if (!appliedDate) continue; // unusable date — no fact, no crash

      const silentDays = daysBetween(appliedDate, now);
      if (silentDays < silenceWindowDays) continue; // right-censored: pending, not silent

      const followupsSent = counts.get(row.num) || 0;
      facts.push({
        num: row.num,
        appliedDate: dateStr,
        status: row.status,
        silentDays,
        followupsSent,
        confidence: followupsSent >= 1 ? 'confirmed-by-followups' : 'unconfirmed',
        stale: silentDays > staleAfterDays,
        // Carried through so buildNoResponseFrictionSignals() can derive
        // postingChannel (#3010) from the anchor fact without a second join
        // back to the tracker row — row.via is the tracker's own tagged
        // via={Agency} field (AGENTS.md's "Optional Via field", #1596), or
        // its em-dash "confirmed direct" convention. Never fabricated here:
        // absent/undefined stays null, exactly like resolveRegion()'s null
        // for "no data", not a guessed value.
        via: row.via ?? null,
        dateBasis,
        // Real set-status.mjs syntax (it rejects unknown flags, so the
        // instruction must only use flags that exist): --on records the real
        // response date in the status ledger — the file funnel-velocity.mjs
        // reads dates back from. A *response* date buried in --note free text
        // is parsed by nothing. (Applied dates are a different story: this same
        // file falls back to parseAppliedDate(row.notes) forty lines up, which
        // is why the qualifier matters — dropping it reads as "dates in notes
        // are dead", and that fallback is load-bearing.)
        clearInstruction: `if they actually responded, node set-status.mjs --row ${row.num} <state> --on <response-date> clears this`,
      });
    } else if (RESPONDED_STATUSES.has(normalized)) {
      // row.date is the EVALUATION date, not the date the company replied. Use
      // it only to age the fact for staleness, and expose it through the same
      // dateBasis convention the silent branch uses — never as a claimed
      // response/contact date.
      const evalDate = parseDate(row.date) ? row.date : undefined;
      const ageBasisDate = evalDate ? parseDate(evalDate) : null;
      const fact = {
        num: row.num,
        outcome: OUTCOME_LABELS[normalized] || row.status,
        stale: ageBasisDate ? daysBetween(ageBasisDate, now) > staleAfterDays : false,
      };
      if (evalDate) {
        fact.date = evalDate;
        fact.dateBasis = 'evaluation-date';
      }
      if (normalized === 'rejected') fact.note = 'a rejection is an answer';
      facts.push(fact);
    }
  }

  facts.sort((a, b) => a.num - b.num);

  const isSilent = f => 'silentDays' in f;
  const isResponded = f => 'outcome' in f;
  const activeFacts = includeStale ? facts : facts.filter(f => !f.stale);
  const hasSilent = activeFacts.some(isSilent);
  const hasResponded = activeFacts.some(isResponded);

  let label;
  if (hasSilent && hasResponded) label = 'mixed';
  else if (hasSilent) label = 'silent-on-you';
  else if (hasResponded) label = 'responded-before';
  else label = 'no-history';

  return {
    label,
    facts,
    medianResponseDays: Number.isFinite(opts.medianResponseDays) ? opts.medianResponseDays : null,
  };
}

// --- Posting-churn axis (pure) ---
//
// `isAggregator` gets its own label rather than folding into `none-detected`.
// The distinction already exists in this enum — `no-scan-data` means the check
// could not run, `none-detected` means it ran and found nothing — and an
// aggregator belongs on the first side: the detector deliberately skipped it,
// so reporting "no reposts" would assert a negative result from a check that
// never happened. That is the same conflation of silence with evidence this
// whole axis was fixed for (#2703).
export function computePostingChurn(clusters, scanHistoryLoaded, isAggregator = false) {
  if (!scanHistoryLoaded) return { label: 'no-scan-data', clusters: [] };
  if (isAggregator) return { label: 'aggregator-not-evaluated', clusters: [] };
  const mapped = (Array.isArray(clusters) ? clusters : []).map(c => ({
    role: c.role,
    repostCount: c.repostCount,
    daysSpan: c.daysSpan,
    lastSeen: c.lastSeen,
  }));
  return { label: mapped.length > 0 ? 'reposts-detected' : 'none-detected', clusters: mapped };
}

// --- Full aggregation (pure — takes already-loaded sources) ---
//
// sources: {
//   trackerRows, followupRows, repostClusters,
//   sourcesLoaded: { tracker, followups, scanHistory, statusLog },
//   statusLogAppliedByNum, medianResponseDays,
// }
// opts: { now, silenceWindowDays, staleAfterDays, includeStale }
export function buildCompanyCards(sources, opts = {}) {
  const trackerRows = Array.isArray(sources.trackerRows) ? sources.trackerRows : [];
  const followupRows = Array.isArray(sources.followupRows) ? sources.followupRows : [];
  const repostClusters = Array.isArray(sources.repostClusters) ? sources.repostClusters : [];
  const sourcesLoaded = sources.sourcesLoaded || { tracker: false, followups: false, scanHistory: false, statusLog: false };

  const silenceWindowDays = Number.isFinite(opts.silenceWindowDays) ? opts.silenceWindowDays : DEFAULT_SILENCE_WINDOW_DAYS;
  const staleAfterDays = Number.isFinite(opts.staleAfterDays) ? opts.staleAfterDays : DEFAULT_STALE_AFTER_DAYS;

  let unjoinable = 0;

  // Group tracker rows by normalized company key.
  const trackerByKey = new Map();
  for (const row of trackerRows) {
    const key = normalizeCompany(String(row?.company || ''));
    if (!key) { unjoinable += 1; continue; }
    if (!trackerByKey.has(key)) trackerByKey.set(key, { company: row.company, rows: [] });
    trackerByKey.get(key).rows.push(row);
  }

  // Follow-ups without a resolvable company key still count towards
  // dataQuality (they contribute to the join universe even though counts are
  // joined by appNum, not company).
  for (const fu of followupRows) {
    const key = normalizeCompany(String(fu?.company || ''));
    if (!key) unjoinable += 1;
  }

  // Group repost clusters by normalized company key (re-key raw cluster strings).
  const clustersByKey = new Map();
  for (const cluster of repostClusters) {
    const key = normalizeCompany(String(cluster?.company || ''));
    if (!key) { unjoinable += 1; continue; }
    if (!clustersByKey.has(key)) clustersByKey.set(key, { company: cluster.company, clusters: [] });
    clustersByKey.get(key).clusters.push(cluster);
  }

  const followupCountsByAppNum = buildFollowupCountsByAppNum(followupRows);

  const keys = new Set([...trackerByKey.keys(), ...clustersByKey.keys()]);

  // A flagged aggregator normally has neither tracker rows nor clusters — the
  // detector skipped it, and you rarely apply to a board — so it would fall out
  // of the union above and vanish from --summary entirely. That is the exact
  // failure the aggregator-not-evaluated label exists to prevent: a company
  // that is missing from the report reads as "nothing to say about it", which
  // is indistinguishable from a clean result. Worse, it is a REGRESSION —
  // before the flag the company appeared, with (wrong) clusters.
  //
  // So seed the key set from the flagged companies too, keyed the way the cards
  // are keyed (normalizeCompany), while membership is still tested with the
  // function that built the lookup (see isAggregatorCompany).
  const aggregatorNameByCardKey = new Map();
  if (sources.aggregators instanceof Map) {
    for (const rawName of sources.aggregators.values()) {
      const cardKey = normalizeCompany(String(rawName || ''));
      if (!cardKey) continue;
      aggregatorNameByCardKey.set(cardKey, rawName);
      keys.add(cardKey);
    }
  }

  const cards = [];
  const hygieneAgedApplied = [];

  for (const key of keys) {
    const trackerGroup = trackerByKey.get(key);
    const clusterGroup = clustersByKey.get(key);
    const companyName = trackerGroup?.company || clusterGroup?.company || aggregatorNameByCardKey.get(key) || key;

    const responsiveness = computeResponsiveness(trackerGroup?.rows || [], followupCountsByAppNum, {
      now: opts.now,
      silenceWindowDays,
      staleAfterDays,
      includeStale: opts.includeStale,
      statusLogAppliedByNum: sources.statusLogAppliedByNum,
      medianResponseDays: sources.medianResponseDays,
    });

    const isAggregator = isAggregatorCompany(companyName, sources.aggregators);
    const postingChurn = computePostingChurn(clusterGroup?.clusters || [], sourcesLoaded.scanHistory, isAggregator);

    const hasAnySilent = responsiveness.facts.some(f => 'silentDays' in f);
    const explanations = hasAnySilent ? [EXPLANATION_LINE] : [];
    if (isAggregator && sourcesLoaded.scanHistory) explanations.push(AGGREGATOR_LINE);

    for (const f of responsiveness.facts) {
      if ('silentDays' in f) {
        hygieneAgedApplied.push({ num: f.num, company: companyName, silentDays: f.silentDays });
      }
    }

    cards.push({ company: companyName, key, responsiveness, postingChurn, explanations });
  }

  cards.sort((a, b) => compareCompany(a.company, b.company));
  hygieneAgedApplied.sort((a, b) => b.silentDays - a.silentDays);

  return {
    metadata: {
      silenceWindowDays,
      staleAfterDays,
      companies: cards.length,
      // Surfaced so "no aggregators configured" is distinguishable from
      // "configured and applied" — a flag that matches nothing otherwise looks
      // exactly like a working one.
      aggregatorCompanies: isKeyLookup(sources.aggregators) ? sources.aggregators.size : 0,
      sources: sourcesLoaded,
    },
    hygiene: { agedApplied: hygieneAgedApplied },
    companies: cards,
    // Carried on the result so getCompanyCard can answer for a company that has
    // no card at all (an aggregator never applied to).
    aggregators: isKeyLookup(sources.aggregators) ? sources.aggregators : new Map(),
    dataQuality: { unjoinable },
  };
}

// Is this company one the user marked `aggregator: true`?
//
// The Set is keyed with normalizeCompanyName (invite-match), while the cards are
// keyed with normalizeCompany (tracker-utils). Those are DIFFERENT functions and
// they disagree on most real names — "joinup.ch" becomes "joinupch" under one
// and "joinup ch" under the other. Testing a card key against this Set would
// therefore match almost nothing, silently: the detector would skip the company
// correctly while the card still claimed `none-detected`. So re-derive the key
// from the raw display name with the SAME function that built the Set.
export function isAggregatorCompany(companyName, aggregators) {
  if (!isKeyLookup(aggregators) || aggregators.size === 0) return false;
  const raw = String(companyName || '').trim();
  if (!raw) return false;
  return aggregators.has(normalizeCompanyName(raw) || raw.toLowerCase());
}

// --- Single-company lookup ---
export function getCompanyCard(result, companyName, aggregators) {
  const key = normalizeCompany(String(companyName || ''));
  const found = result.companies.find(c => c.key === key);
  if (found) return found;

  // An aggregator the user never applied to has no tracker rows and no
  // clusters, so it lands here. It must still not claim `none-detected` — the
  // check was skipped for it, exactly as on the full card.
  const scanHistoryLoaded = !!result.metadata?.sources?.scanHistory;
  const isAggregator = isAggregatorCompany(companyName, aggregators ?? result.aggregators);
  const churnLabel = !scanHistoryLoaded
    ? 'no-scan-data'
    : (isAggregator ? 'aggregator-not-evaluated' : 'none-detected');
  return {
    company: companyName,
    key,
    responsiveness: { label: 'no-history', facts: [] },
    postingChurn: { label: churnLabel, clusters: [] },
    explanations: isAggregator && scanHistoryLoaded ? [AGGREGATOR_LINE] : [],
  };
}

// --- no-response-friction signal emission (RFC #1506 schema v1, --emit-signal only) ---
//
// Opt-in, local-only. Reuses the `silent-on-you` responsiveness fact
// company-history.mjs already computes above (computeResponsiveness()) rather
// than deriving a second silence detector: the 28-day DEFAULT_SILENCE_WINDOW_DAYS
// (or its --silence-window override) IS this signal's threshold. RFC #1506's
// original discussion floated a 14-day baseline before this script's 28-day
// window shipped in #1712; per #2787 we standardize on the one window this
// script already has tested rather than adding a second, undocumented cutoff.
//
// Schema v1 (verbatim from RFC #1506, ratified 2026-07-16 — full 10-field
// shape, per @Schlaflied's converged-schema comment that @santifer ratified):
//   { schemaVersion: 1, companyKey, region, signalType: 'no-response-friction',
//     detail: null, severity: 'single'|'pattern'|null,
//     sourceDetector: 'company-history', sourceHash: 'sha256:...',
//     observedAt: 'YYYY-MM', emittedBy: 'career-ops vX.Y.Z' }
//
// `sourceDetector` enum so far: 'interview-redflag' | 'process-friction'
// (named in the RFC thread) | 'company-history' (this script — the third,
// established here per artemtrofymenko's PR #2788 review). Originally set to
// 'no-response-friction' (the signal name); renamed to 'company-history' per
// a follow-up (weak-preference, non-blocking) suggestion from the same
// reviewer: the existing precedent is interview-redflag.mjs, which emits 4
// different signal types under the RFC's enum but always tags
// `sourceDetector: 'interview-redflag'` — the TOOL name, not any one signal
// name. sourceDetector identifies the producing script, not the specific
// signal type it happened to emit. This also future-proofs the value:
// company-history.mjs already computes two independent axes
// (responsiveness and postingChurn); only responsiveness feeds a signal
// today (no-response-friction), but if postingChurn ever feeds a second
// signal type later, a value scoped to this one signal would be wrong for
// that record — 'company-history' stays correct regardless of how many
// signal types this script eventually produces. Renaming an enum value
// already present in emitted records is expensive, so this was worth fixing
// before anything shipped with the old value.
// `detail` is null here — this signal is derived purely from tracker dates,
// with no free text to carry (unlike e.g. process-friction's
// "interviewer no-show, no reschedule notice" example in the RFC).
//
// Privacy: enum/hash/date fields only — no candidate name, no free-text notes,
// no verbatim quotes anywhere in an emitted record (same discipline as
// interview-redflag / process-friction).
//
// ADDITIVE field, not part of the ratified v1 shape above: `postingChannel`
// ('direct-employer' | 'staffing-agency' | 'unknown'), proposed in #3010 and
// pending its own review — kept separate from the RFC-ratified 10 fields
// because it has not itself been ratified. Per @strelov1's (freehire.me)
// production measurement cited in #3010, a single-criterion structural
// signal like this one systematically misfires on staffing/recruiting
// agencies, which legitimately post client roles that never appear on their
// own careers page — conflating "agency-mediated posting" with "shady
// posting". No new detection: it wires in the tracker's own existing tagged
// `via={Agency}` field (#1596) via resolvePostingChannel() below, the same
// "never fabricate, degrade to unknown" discipline resolveRegion() already
// uses for the `region` field above.

// Best-effort country -> region-slug mapping for the RFC's `region` field
// (e.g. "north-america/canada"). Deliberately small: covers the markets this
// repo already has explicit support for (see modes/<lang>/ market sets) plus
// a few common others. An unmapped or missing country degrades to a slug of
// the raw country string (still useful for grouping) rather than crashing or
// guessing a continent — 'unknown' when there is no country at all.
const COUNTRY_REGION_MAP = {
  canada: 'north-america/canada',
  'united states': 'north-america/united-states',
  'united states of america': 'north-america/united-states',
  usa: 'north-america/united-states',
  us: 'north-america/united-states',
  mexico: 'north-america/mexico',
  'united kingdom': 'europe/united-kingdom',
  uk: 'europe/united-kingdom',
  germany: 'europe/germany',
  austria: 'europe/austria',
  switzerland: 'europe/switzerland',
  france: 'europe/france',
  belgium: 'europe/belgium',
  luxembourg: 'europe/luxembourg',
  japan: 'asia/japan',
  india: 'asia/india',
  turkey: 'asia/turkey',
  china: 'asia/china',
  'saudi arabia': 'middle-east/saudi-arabia',
  uae: 'middle-east/united-arab-emirates',
  'united arab emirates': 'middle-east/united-arab-emirates',
  qatar: 'middle-east/qatar',
  australia: 'oceania/australia',
  'new zealand': 'oceania/new-zealand',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Reads config/profile.yml -> location.country the same way followup-cadence.mjs
// reads config/profile.yml (existsSync guard, try/catch parse, silent
// degradation — a missing or unparsable profile must never crash signal
// emission). Returns null when a region genuinely cannot be resolved (no
// profile, unparsable profile, no country field) — per artemtrofymenko's
// review on PR #2788, a literal 'unknown' string would imply a real
// `unknown/` shared-layer directory if this schema were ever published, so
// callers must treat null as "skip emission, don't fabricate a region"
// rather than emitting a misleading placeholder value. A country that IS
// present but unmapped in COUNTRY_REGION_MAP still resolves (to
// `unmapped/<slug>`) — that is real information, not a placeholder.
export function resolveRegion(profilePath = PROFILE_FILE) {
  if (!profilePath || !existsSync(profilePath)) return null;
  let raw;
  try {
    raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    return null;
  }
  const country = raw?.location?.country;
  if (!country || typeof country !== 'string') return null;
  const mapped = COUNTRY_REGION_MAP[country.trim().toLowerCase()];
  if (mapped) return mapped;
  const slug = slugify(country);
  return slug ? `unmapped/${slug}` : null;
}

// Distinguishes who actually posted the role — the direct employer, or a
// third-party staffing/recruiting agency filling a client req — for the
// additive `postingChannel` field (#3010; see the schema comment block
// above). Reuses the tracker's own existing `via` convention (AGENTS.md's
// "Optional Via field", #1596) rather than adding new detection: a non-empty
// tagged value that isn't the em-dash sentinel means agency-mediated; the
// tracker's own em-dash convention means confirmed-direct; and — matching
// resolveRegion()'s "never fabricate, degrade to a real absence" discipline
// — an undefined, null, or blank/whitespace-only `via` means no data was
// ever recorded either way, so this returns 'unknown' rather than guessing
// 'direct-employer'. `unknown` here is a real, RFC-sanctioned enum value
// (unlike resolveRegion()'s rejected 'unknown' literal), so no null-vs-string
// caller-side handling is needed the way region emission requires.
export function resolvePostingChannel(via) {
  if (typeof via !== 'string') return 'unknown';
  const trimmed = via.trim();
  if (!trimmed) return 'unknown';
  return trimmed === '—' ? 'direct-employer' : 'staffing-agency';
}

// package.json version -> "career-ops vX.Y.Z". Missing/unparsable package.json
// degrades to a version-less emittedBy rather than crashing.
export function resolveEmittedBy(packagePath = PACKAGE_JSON) {
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    if (pkg && typeof pkg.version === 'string' && pkg.version) {
      return `career-ops v${pkg.version}`;
    }
  } catch {
    // fall through
  }
  return 'career-ops';
}

// Deterministic (not random) so repeated runs against the same underlying
// fact produce the same sourceHash — required for downstream dedup. The
// hashed input is already fully reconstructable from the record's own
// plaintext fields (companyKey/observedAt/signalType), so the hash adds no
// additional linkable information beyond what those fields already expose;
// it is opaque only in the sense that it cannot be reversed back into
// anything MORE sensitive (raw applicant identity, notes text, etc.) than is
// already in plaintext.
//
// `severity` is deliberately EXCLUDED from the hash (fixed per
// artemtrofymenko's PR #2788 review, which caught this against a real
// tracker): severity can legitimately change over time for the SAME
// underlying company-month fact (e.g. a candidate applies once and goes
// silent -> 'single'; applies again later and also goes silent -> 'pattern').
// Hashing severity in would make the same companyKey+observedAt fact produce
// a different sourceHash depending on when the record was emitted, so a
// downstream dedup pool couldn't tell two emissions describe the same
// evolving fact — both would coexist with contradictory severity instead of
// the later one superseding the earlier. Keying the hash on
// signalType|companyKey|observedAt only (what is being described, not values
// that can accumulate) makes companyKey|observedAt the stable identity.
export function computeSourceHash({ companyKey, observedAt }) {
  const raw = `no-response-friction|${companyKey}|${observedAt}`;
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

// One silent fact -> its observedAt month. Anchored on fact.appliedDate's own
// month directly — deliberately NOT on appliedDate + silenceWindowDays. The
// window is configurable (--silence-window, or resolveDefaultSilenceWindow())
// so a window-derived observedAt would shift month (and therefore shift
// sourceHash, see computeSourceHash above) for the SAME underlying silent
// fact depending on what window happened to be in effect on a given run —
// which breaks the dedup that sourceHash exists to support. appliedDate never
// changes for a given fact, so anchoring on it keeps the hash stable.
function silentFactObservedAt(fact) {
  const appliedDate = parseDate(fact.appliedDate);
  // parseDate() tolerates surrounding whitespace when validating, but the
  // schema's observedAt (and sourceHash, which is computed over it) must be
  // a clean YYYY-MM slice — so trim before slicing, not just before
  // validating, or a whitespace-padded appliedDate (e.g. ' 2026-06-01 ')
  // would slice out the leading space plus wrong characters instead of the
  // real year-month.
  const source = appliedDate ? fact.appliedDate.trim() : null;
  return typeof source === 'string' && source.length >= 7 ? source.slice(0, 7) : null;
}

// Builds schema-v1 no-response-friction records for every `silent-on-you`
// company card. Only `silent-on-you` cards ever produce a record — 'mixed'
// (silent on some, responded on others), 'responded-before', and 'no-history'
// cards never do, since the point of this signal is companies that have
// NEVER answered this candidate.
//
// severity: 'single' for exactly one silent fact on the card, 'pattern' for
// 2+ (the candidate applied more than once and went unanswered more than
// once at the same company).
//
// opts.includeStale mirrors the CLI's --include-stale flag: pass true to
// count stale (>365d, or --staleAfterDays override) silent facts towards
// severity, matching whatever includeStale value the caller used to compute
// `result`'s labels. Left false (the default), a stale silent fact never
// contributes to severity, keeping severity consistent with the label it
// rode in on.
//
// Returns { records, warnings } (matching this repo's established
// discover-ats.mjs / check-table-freshness.mjs shape), not a bare array.
// region is resolved once per run (it is a property of the candidate's own
// profile, not of any individual company) — when it cannot be resolved,
// per artemtrofymenko's PR #2788 review, this "says nothing" rather than
// emitting a misleading 'unknown' literal: no records are emitted for this
// run and a warning explains why, instead of hard-erroring the whole
// command over one unresolvable field.
export function buildNoResponseFrictionSignals(result, opts = {}) {
  const region = opts.region ?? resolveRegion(opts.profilePath);
  const emittedBy = opts.emittedBy ?? resolveEmittedBy(opts.packagePath);
  const includeStale = !!opts.includeStale;

  const records = [];
  const warnings = [];

  for (const card of Array.isArray(result?.companies) ? result.companies : []) {
    if (card?.responsiveness?.label !== 'silent-on-you') continue;

    // region is a property of the candidate's own profile, so it is the
    // same (or the same absence) for every company in a given run — but the
    // skip is expressed per-company (rather than as one early return for the
    // whole call) so the warning names exactly which company's signal was
    // dropped, matching the shape a future per-company region override could
    // reuse without a rewrite here.
    if (!region) {
      warnings.push(`region could not be resolved from config/profile.yml — signal not emitted for ${card.key}.`);
      continue;
    }

    // Mirror computeResponsiveness()'s own stale filter: the label was
    // computed from activeFacts (stale facts excluded unless --include-stale),
    // but card.responsiveness.facts still carries every fact, stale or not.
    // Without this filter a card with one active + one stale silent fact
    // would report severity 'pattern' even though only one fact actually
    // contributed to the 'silent-on-you' label.
    const activeFacts = includeStale ? card.responsiveness.facts : card.responsiveness.facts.filter(f => !f.stale);
    // A fact with an unusable appliedDate must be excluded before anchor
    // selection and severity counting, not just skipped later when computing
    // observedAt from the already-chosen anchor: left in, a malformed date
    // could win the lexicographic reduce below (producing no usable
    // observedAt at all) or, even when a valid fact wins the anchor, still
    // inflate severity to 'pattern' despite not actually contributing a
    // usable silent-application fact (CodeRabbit, PR #2788).
    const silentFacts = activeFacts.filter(f => 'silentDays' in f && silentFactObservedAt(f) !== null);
    if (silentFacts.length === 0) continue; // defensive; label implies >=1

    // Most-recent APPLICATION anchors observedAt — compare appliedDate, not
    // tracker row num. num is just row-insertion order; a backfilled or
    // out-of-order row can carry a larger num with an OLDER appliedDate, which
    // would silently anchor on a stale application despite the "most-recent"
    // intent. ISO date strings sort correctly with plain string comparison —
    // but only once trimmed: a whitespace-padded value (e.g. ' 2026-06-01 ')
    // compares incorrectly against an untrimmed neighbor, which would select
    // the wrong anchor and emit a wrong observedAt/sourceHash (CodeRabbit,
    // PR #2788).
    const anchorFact = silentFacts.reduce((a, b) => (
      String(b.appliedDate).trim() > String(a.appliedDate).trim() ? b : a
    ));
    const observedAt = silentFactObservedAt(anchorFact);
    if (!observedAt) continue; // unusable date — no record, no crash

    const severity = silentFacts.length >= 2 ? 'pattern' : 'single';
    // postingChannel rides on the same anchor fact as observedAt — it is a
    // property of that specific application (the tracker row's own `via`),
    // not of the company card as a whole, so it must not be recomputed from
    // a different fact than the one that decided observedAt/sourceHash.
    const postingChannel = resolvePostingChannel(anchorFact.via);

    records.push({
      schemaVersion: 1,
      companyKey: card.key,
      region,
      signalType: 'no-response-friction',
      detail: null,
      severity,
      sourceDetector: 'company-history',
      sourceHash: computeSourceHash({ companyKey: card.key, observedAt }),
      observedAt,
      emittedBy,
      postingChannel,
    });
  }

  records.sort((a, b) => compareCompany(a.companyKey, b.companyKey));
  return { records, warnings };
}

// --- Summary rendering (pure) ---
const LABEL_ORDER = { 'silent-on-you': 0, mixed: 1, 'responded-before': 2, 'no-history': 3 };

export function renderSummary(result) {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(78));
  lines.push('  Company History — career-ops');
  lines.push(`  companies: ${result.companies.length} | silence window: ${result.metadata.silenceWindowDays}d`);
  lines.push('='.repeat(78));
  lines.push('');

  const aged = result.hygiene?.agedApplied || [];
  if (aged.length > 0) {
    lines.push(`  ${aged.length} aged-Applied row(s) look silent — confirm real or update (node set-status.mjs --row <num> <state> --on <response-date>).`);
    lines.push('');
  }

  lines.push('  silence window: ' + result.metadata.silenceWindowDays + 'd — slow to reply is common; silence within the window is expected.');
  lines.push('');

  const sorted = [...result.companies].sort((a, b) => {
    const rank = (LABEL_ORDER[a.responsiveness.label] ?? 9) - (LABEL_ORDER[b.responsiveness.label] ?? 9);
    return rank !== 0 ? rank : compareCompany(a.company, b.company);
  });

  if (sorted.length === 0) {
    lines.push('  No company evidence available (no tracker, follow-up, or scan-history data found).');
    lines.push('');
  }

  for (const card of sorted) {
    lines.push(`  ${card.company} [${card.responsiveness.label}] — postings: ${card.postingChurn.label}`);
    for (const f of card.responsiveness.facts) {
      if ('silentDays' in f) {
        const staleTag = f.stale ? ' (stale)' : '';
        lines.push(`      #${f.num} silent ${f.silentDays}d since ${f.appliedDate} — ${f.followupsSent} follow-up(s), ${f.confidence}${staleTag}`);
      } else {
        const note = f.note ? ` (${f.note})` : '';
        lines.push(`      #${f.num} ${f.outcome}${f.date ? ` (evaluated ${f.date})` : ''}${note}`);
      }
    }
    for (const c of card.postingChurn.clusters) {
      lines.push(`      repost: "${c.role}" seen ${c.repostCount}x over ${c.daysSpan}d, last ${c.lastSeen}`);
    }
    // Every explanation, not just the first: a company can be both silent on
    // you AND an aggregator, and printing only [0] would drop the second.
    for (const explanation of card.explanations) {
      lines.push(`      note: ${explanation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Self-test ---
async function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  const NOW = new Date('2026-07-09T00:00:00Z');
  const row = (num, company, status, date, notes = '') => ({ num, date, company, role: 'Engineer', score: '4/5', status, pdf: '✅', report: `reports/${num}.md`, notes });

  // --- join fixtures: case/punct variants meet under one key; only a genuinely
  // keyless company is unjoinable. A non-Latin name is NOT keyless (#2429):
  // normalizeCompany() folds script-preserving, so 株式会社 keys as itself and
  // gets a real card instead of being discarded as unparseable data. ---
  {
    const rows = [
      row(1, 'Acme Inc.', 'Applied', '2026-01-01'),
      row(2, 'ACME, INC', 'Applied', '2026-01-02'),
      row(3, '?', 'Applied', '2026-01-03'), // punctuation only -> genuinely keyless
    ];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(result.companies.length === 1, 'case/punct company variants join under one key');
    check(result.companies[0].responsiveness.facts.length === 2, 'both joined rows contribute facts to the single card');
    check(result.dataQuality.unjoinable === 1, 'a punctuation-only company key is excluded and counted as unjoinable');
  }

  // --- non-Latin companies are first-class, and distinct from each other (#2429) ---
  {
    const rows = [
      row(4, 'アクメ株式会社', 'Applied', '2026-01-01'),
      row(5, 'グロベックス合同会社', 'Applied', '2026-01-02'),
      row(6, 'Яндекс', 'Applied', '2026-01-03'),
    ];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(result.companies.length === 3, 'three different non-Latin companies produce three cards, not one');
    check(result.dataQuality.unjoinable === 0, 'a non-Latin company name is joinable, not a data-quality defect');
  }

  // --- label goldens ---
  {
    // silent-on-you: one Applied row well past the window, nothing else.
    const silentOnly = buildCompanyCards(
      { trackerRows: [row(10, 'SilentCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(silentOnly.companies[0].responsiveness.label === 'silent-on-you', 'silent-only fixture labels silent-on-you');

    // responded-before: a Rejected row only.
    const respondedOnly = buildCompanyCards(
      { trackerRows: [row(11, 'RespondedCo', 'Rejected', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(respondedOnly.companies[0].responsiveness.label === 'responded-before', 'responded-only fixture labels responded-before');

    // mixed: one silent-old Applied row + one later Rejected row (different app).
    const mixed = buildCompanyCards(
      {
        trackerRows: [
          row(12, 'MixedCo', 'Applied', '2026-05-01'),
          row(13, 'MixedCo', 'Rejected', '2026-06-20'),
        ],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(mixed.companies[0].responsiveness.label === 'mixed', 'silent-old + responded-later fixture labels mixed (both retained in facts)');
    check(mixed.companies[0].responsiveness.facts.length === 2, 'mixed card retains both the silent and the responded fact');

    // no-history: an Evaluated row only (never applied, never responded).
    const noHistory = buildCompanyCards(
      { trackerRows: [row(14, 'NoHistoryCo', 'Evaluated', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(noHistory.companies[0].responsiveness.label === 'no-history', 'Evaluated-only fixture labels no-history');
    check(noHistory.companies[0].responsiveness.facts.length === 0, 'no-history card carries no facts');
  }

  // --- right-censoring: Applied row younger than window -> pending, not silent ---
  {
    const pending = buildCompanyCards(
      { trackerRows: [row(20, 'PendingCo', 'Applied', '2026-07-05')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(pending.companies[0].responsiveness.facts.length === 0, 'Applied row younger than the window produces no fact (pending, right-censored)');
    check(pending.companies[0].responsiveness.label === 'no-history', 'a lone pending row labels no-history, not silent-on-you');
  }

  // --- rejection-is-an-answer ---
  {
    const rejected = computeResponsiveness([row(30, 'RejCo', 'Rejected', '2026-06-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    check(rejected.facts.length === 1 && rejected.facts[0].outcome === 'Rejected', 'Rejected row produces a responded fact with outcome Rejected');
    check(rejected.facts[0].note === 'a rejection is an answer', 'Rejected fact carries the rejection-is-an-answer note');
  }

  // --- a hire is the strongest answer (must not fall through to no-history) ---
  {
    const hired = computeResponsiveness([row(31, 'HireCo', 'Hired', '2026-06-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    check(hired.facts.length === 1 && hired.facts[0].outcome === 'Hired', 'Hired row produces a responded fact with outcome Hired');
    check(hired.label === 'responded-before', 'a company that hired you labels responded-before, never no-history');
  }

  // --- pin-line exclusion (parseFollowups already handles this; assert via fixture) ---
  {
    const followupsMd = [
      '| # | App# | Date | Company | Role | Channel | Contact | Notes |',
      '|---|------|------|---------|------|---------|---------|-------|',
      '| 1 | 40 | 2026-06-01 | PinCo | Engineer | Email | jane@pinco.com | first nudge |',
      '- next #40 2026-07-15 (set 2026-07-01)',
    ].join('\n');
    const followupRows = parseFollowups(followupsMd);
    check(followupRows.length === 1, 'pin-directive line is not parsed as a sent follow-up row');
    check(followupRows[0].appNum === 40, 'the one real follow-up row parses with the expected appNum');
  }

  // --- confidence-not-label: same label, different confidence ---
  {
    const followupRows = [
      { num: 1, appNum: 50, date: '2026-06-01', company: 'ConfA', role: 'x', channel: 'Email', contact: 'a@a.com', notes: '' },
      { num: 2, appNum: 50, date: '2026-06-08', company: 'ConfA', role: 'x', channel: 'Email', contact: 'a@a.com', notes: '' },
    ];
    const result = buildCompanyCards(
      {
        trackerRows: [row(50, 'ConfA', 'Applied', '2026-05-01'), row(51, 'ConfB', 'Applied', '2026-05-01')],
        followupRows, repostClusters: [],
        sourcesLoaded: { tracker: true, followups: true, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    const confA = getCompanyCard(result, 'ConfA');
    const confB = getCompanyCard(result, 'ConfB');
    check(confA.responsiveness.label === 'silent-on-you' && confB.responsiveness.label === 'silent-on-you', 'both rows share the silent-on-you label regardless of follow-up count');
    check(confA.responsiveness.facts[0].confidence === 'confirmed-by-followups', '2 follow-ups sent -> confirmed-by-followups');
    check(confB.responsiveness.facts[0].confidence === 'unconfirmed', '0 follow-ups sent -> unconfirmed');
  }

  // --- stale: fact >365d old excluded from label by default; --include-stale includes ---
  {
    const staleRows = [row(60, 'StaleCo', 'Applied', '2025-01-01')]; // ~554 days before NOW
    const defaultResult = computeResponsiveness(staleRows, new Map(), { now: NOW, silenceWindowDays: 28 });
    check(defaultResult.facts[0].stale === true, 'a >365d-old Applied row is flagged stale');
    check(defaultResult.label === 'no-history', 'a stale-only fact is excluded from label computation by default');

    const includeStaleResult = computeResponsiveness(staleRows, new Map(), { now: NOW, silenceWindowDays: 28, includeStale: true });
    check(includeStaleResult.label === 'silent-on-you', '--include-stale includes the stale fact in label computation');
  }

  // --- absent-file degradation: each source absent -> false, no crash, other axes still work ---
  {
    const bogusRoot = join(CAREER_OPS, '__does-not-exist__');
    const tracker = loadTrackerRows(bogusRoot);
    check(tracker.loaded === false && tracker.rows.length === 0, 'loadTrackerRows against a nonexistent root degrades gracefully');

    const followups = loadFollowupRows(bogusRoot);
    check(followups.loaded === false && followups.rows.length === 0, 'loadFollowupRows against a nonexistent root degrades gracefully');

    const scanHistory = loadRepostClusters(bogusRoot);
    check(scanHistory.loaded === false && scanHistory.clusters.length === 0, 'loadRepostClusters against a nonexistent root degrades gracefully');

    const result = buildCompanyCards(
      {
        trackerRows: [row(70, 'AloneCo', 'Applied', '2026-05-01')],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(result.companies[0].responsiveness.label === 'silent-on-you', 'responsiveness axis still computes when other sources are absent');
    check(result.companies[0].postingChurn.label === 'no-scan-data', 'churn axis reports no-scan-data when scan-history is absent');
  }

  // --- funnel-velocity loader is honestly inert against the merged module ---
  {
    // The merged funnel-velocity.mjs imports fine but exports neither optional
    // helper (getAppliedDateObservations / computeMedianResponseDays), so the
    // loader must report the statusLog source ABSENT — no applied-date
    // observations, null median — rather than claiming loaded just because the
    // import resolved. Assert the ACTUAL loader result against the real module.
    const statusLog = await loadStatusLogSource();
    check(statusLog.loaded === false, 'loadStatusLogSource reports statusLog absent when the merged module exports no usable helper');
    check(statusLog.appliedDateByNum instanceof Map && statusLog.appliedDateByNum.size === 0, 'loadStatusLogSource yields an empty appliedDateByNum against the merged module');
    check(statusLog.medianResponseDays === null, 'loadStatusLogSource yields null medianResponseDays against the merged module');

    // Downstream contract: computeResponsiveness surfaces a null median when the
    // loader supplied none.
    const result = computeResponsiveness([row(80, 'NoStatusLogCo', 'Applied', '2026-05-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    check(result.medianResponseDays === null, 'medianResponseDays is null when not supplied (statusLog absent)');
  }

  // --- --company lookup: known company returns card; unknown returns no-history shape ---
  {
    const result = buildCompanyCards(
      { trackerRows: [row(90, 'KnownCo', 'Rejected', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const known = getCompanyCard(result, 'KnownCo');
    check(known.responsiveness.label === 'responded-before', 'known company lookup returns its real card');

    const unknown = getCompanyCard(result, 'NeverHeardOfThemCo');
    check(unknown.responsiveness.label === 'no-history' && unknown.responsiveness.facts.length === 0, 'unknown company lookup returns the minimal no-history shape');
    check(unknown.postingChurn.label === 'no-scan-data', 'unknown company lookup reports no-scan-data churn when scan-history never loaded');
  }

  // --- distribution-sanity: 5 companies, not everything is silent-on-you ---
  {
    const rows = [
      row(100, 'RespondedA', 'Rejected', '2026-06-01'),
      row(101, 'RespondedB', 'Interview', '2026-06-10'),
      row(102, 'SilentC', 'Applied', '2026-05-01'),
      row(103, 'PendingOnlyD', 'Applied', '2026-07-05'),
      row(104, 'NoHistoryE', 'Evaluated', '2026-06-01'),
    ];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const labels = result.companies.map(c => c.responsiveness.label);
    check(labels.filter(l => l === 'responded-before').length === 2, 'distribution fixture: 2 companies responded-before');
    check(labels.filter(l => l === 'silent-on-you').length === 1, 'distribution fixture: 1 company silent-on-you');
    check(labels.filter(l => l === 'no-history').length === 2, 'distribution fixture: 2 companies no-history (pending-only + evaluated-only)');
    check(!labels.every(l => l === 'silent-on-you'), 'distribution fixture: NOT everything is silent-on-you');
  }

  // --- aggregator companies (#2703) ---
  {
    // "joinup.ch" is chosen deliberately: normalizeCompany (which keys the
    // cards) gives "joinupch" while normalizeCompanyName (which keys the
    // aggregator Set) gives "joinup ch". If the membership test is ever
    // "simplified" to compare the card key against the Set, this fixture fails
    // — a single-word name, where both normalizers agree, would pass and prove
    // nothing. It is also the entry portals.example.yml ships.
    const aggregators = new Set([normalizeCompanyName('joinup.ch')]);
    const sourcesLoaded = { tracker: true, followups: false, scanHistory: true, statusLog: false };

    const result = buildCompanyCards(
      {
        trackerRows: [row(200, 'joinup.ch', 'Evaluated', '2026-06-01'), row(201, 'RegularCo', 'Evaluated', '2026-06-01')],
        followupRows: [],
        repostClusters: [{ company: 'RegularCo', role: 'Engineer', repostCount: 2, daysSpan: 30, lastSeen: '2026-06-20' }],
        aggregators,
        sourcesLoaded,
      },
      { now: NOW, silenceWindowDays: 28 },
    );

    const board = getCompanyCard(result, 'joinup.ch');
    check(board.postingChurn.label === 'aggregator-not-evaluated', 'an aggregator reports aggregator-not-evaluated, never none-detected');
    check(board.postingChurn.clusters.length === 0, 'an aggregator card carries no clusters');
    check(
      board.explanations.some(e => /aggregator/i.test(e) && /not evaluated/i.test(e)),
      'the aggregator card says the axis was not evaluated rather than leaving it bare',
    );

    const regular = getCompanyCard(result, 'RegularCo');
    check(regular.postingChurn.label === 'reposts-detected', 'a non-aggregator company is unaffected');
    check(result.metadata.aggregatorCompanies === 1, 'metadata reports how many aggregators were configured');

    // A flagged board with NO tracker rows and NO clusters — the normal case,
    // since the detector skips it and you rarely apply to a board. It must
    // still get a card and still appear in --summary. It fell out of the
    // tracker-union-clusters key set and vanished from the report entirely,
    // which is the same silence the label exists to prevent, and a regression
    // against the unflagged behaviour where the company did appear.
    const boardOnly = buildCompanyCards(
      {
        trackerRows: [],
        followupRows: [],
        repostClusters: [],
        aggregators: new Map([[normalizeCompanyName('joinup.ch'), 'joinup.ch']]),
        sourcesLoaded,
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(boardOnly.companies.length === 1, 'a flagged board with no tracker rows and no clusters still gets a card');
    check(
      boardOnly.companies[0]?.company === 'joinup.ch',
      'that card is titled with the name from portals.yml, not the normalized key',
    );
    check(
      boardOnly.companies[0]?.postingChurn.label === 'aggregator-not-evaluated',
      'the card-less board still reports aggregator-not-evaluated',
    );
    check(/joinup\.ch/.test(renderSummary(boardOnly)), 'the flagged board appears in --summary rather than vanishing from it');

    // The loader hands back a Map; a hand-built Set must keep working.
    const viaSet = buildCompanyCards(
      {
        trackerRows: [], followupRows: [], repostClusters: [],
        aggregators: new Set([normalizeCompanyName('joinup.ch')]), sourcesLoaded,
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(viaSet.metadata.aggregatorCompanies === 1, 'a Set of keys is still accepted alongside the loader\'s Map');

    // Same fixture with no aggregators configured: the ONLY difference is the
    // Set, so this proves the label above comes from the flag and not from the
    // company simply having no clusters.
    const unflagged = buildCompanyCards(
      {
        trackerRows: [row(200, 'joinup.ch', 'Evaluated', '2026-06-01')],
        followupRows: [], repostClusters: [], aggregators: new Set(), sourcesLoaded,
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(getCompanyCard(unflagged, 'joinup.ch').postingChurn.label === 'none-detected', 'the same company unflagged reports none-detected');
    check(unflagged.metadata.aggregatorCompanies === 0, 'metadata reports zero when nothing is flagged');

    // An aggregator never applied to has no card at all and falls through the
    // unknown-company path — it must not claim none-detected there either.
    const unknownBoard = getCompanyCard(result, 'joinup.ch — Never Tracked', aggregators);
    check(
      unknownBoard.postingChurn.label === 'none-detected',
      'an unrelated unknown company still reports none-detected',
    );
    const unknownFlagged = getCompanyCard(
      { ...result, companies: [] },
      'joinup.ch',
    );
    check(
      unknownFlagged.postingChurn.label === 'aggregator-not-evaluated',
      'an aggregator with no card still reports aggregator-not-evaluated via result.aggregators',
    );

    // Both notes must survive together — a board you also applied to.
    const both = buildCompanyCards(
      {
        trackerRows: [row(202, 'joinup.ch', 'Applied', '2026-05-01')],
        followupRows: [], repostClusters: [], aggregators, sourcesLoaded,
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    const bothCard = getCompanyCard(both, 'joinup.ch');
    check(bothCard.explanations.length === 2, 'a silent aggregator keeps BOTH the silence note and the aggregator note');
    check(renderSummary(both).split('note:').length - 1 === 2, 'renderSummary prints every note, not only the first');
  }

  // --- vocabulary assertions ---
  {
    const rows = [row(110, 'VocabCo', 'Applied', '2026-01-01')];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const output = renderSummary(result);
    check(!/risk/i.test(output), 'rendered summary never contains the word "risk"');
    check(!/ghost/i.test(output), 'rendered summary never contains the word "ghost"');
  }

  // --- every silent fact has date + clearInstruction with real set-status syntax ---
  {
    const result = computeResponsiveness([row(120, 'ClearCo', 'Applied', '2026-01-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    const fact = result.facts[0];
    check(!!fact.appliedDate, 'silent fact carries an appliedDate');
    check(typeof fact.clearInstruction === 'string' && fact.clearInstruction.includes('set-status'), 'silent fact clearInstruction references set-status.mjs');
    check(fact.clearInstruction.includes('--row'), 'silent fact clearInstruction selects the tracker row explicitly via --row');
    check(fact.clearInstruction.includes('--on'), 'silent fact clearInstruction records the response date via --on, not --note free text');
    check(!fact.clearInstruction.includes('--note'), 'silent fact clearInstruction does not smuggle the response date into --note free text');
  }

  // --- no-response-friction signal emission (RFC #1506 schema v1, #2787) ---
  {
    const fixedOpts = { region: 'north-america/canada', emittedBy: 'career-ops vTEST' };

    // single: exactly one silent fact on the card.
    const singleResult = buildCompanyCards(
      { trackerRows: [row(200, 'SingleSilentCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: singleSignals, warnings: singleWarnings } = buildNoResponseFrictionSignals(singleResult, fixedOpts);
    check(singleWarnings.length === 0, 'resolvable region: no warnings emitted');
    check(singleSignals.length === 1, 'exactly one no-response-friction record emitted for a single silent-on-you card');
    check(singleSignals[0]?.severity === 'single', 'one silent fact on the card -> severity single');
    check(singleSignals[0]?.signalType === 'no-response-friction', 'emitted record carries signalType no-response-friction');
    check(singleSignals[0]?.companyKey === singleResult.companies[0].key, 'emitted companyKey reuses company-history.mjs\'s own normalized key, not a new format');
    check(singleSignals[0]?.region === 'north-america/canada', 'emitted region matches the resolved region');
    check(singleSignals[0]?.emittedBy === 'career-ops vTEST', 'emitted emittedBy matches the resolved version string');
    check(/^\d{4}-\d{2}$/.test(singleSignals[0]?.observedAt || ''), 'observedAt is strictly month-only (YYYY-MM, no day)');
    check(typeof singleSignals[0]?.sourceHash === 'string' && singleSignals[0].sourceHash.startsWith('sha256:'), 'sourceHash is present and sha256-prefixed');
    check(singleSignals[0]?.schemaVersion === 1, 'emitted record carries schemaVersion 1 (ratified RFC #1506 shape)');
    check(singleSignals[0]?.detail === null, 'emitted record carries detail: null — this signal is derived purely from dates, no free text');
    check(singleSignals[0]?.sourceDetector === 'company-history', 'emitted record carries sourceDetector: company-history (the producing tool, not the signal name — matches interview-redflag.mjs precedent)');

    // pattern: two SEPARATE applications to the same company, both silent.
    const patternResult = buildCompanyCards(
      {
        trackerRows: [
          row(201, 'PatternSilentCo', 'Applied', '2026-01-01'),
          row(202, 'PatternSilentCo', 'Applied', '2026-02-01'),
        ],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(patternResult.companies[0].responsiveness.label === 'silent-on-you', 'two-application silent fixture still labels silent-on-you (precondition for the pattern check below)');
    const { records: patternSignals } = buildNoResponseFrictionSignals(patternResult, fixedOpts);
    check(patternSignals.length === 1, 'still exactly one record per company card, even with 2 silent facts');
    check(patternSignals[0]?.severity === 'pattern', 'two silent facts on the same card -> severity pattern');

    // artemtrofymenko's PR #2788 review scenario, verbatim: the SAME
    // companyKey + observedAt (same company, same month) must produce the
    // SAME sourceHash whether the card carries 1 silent fact (severity
    // 'single') or 2 (severity 'pattern') — severity is explicitly excluded
    // from the hash so a later emission with updated severity supersedes
    // the earlier one in a dedup pool instead of coexisting as a phantom
    // duplicate.
    const sameMonthSingleResult = buildCompanyCards(
      { trackerRows: [row(240, 'SeverityHashCo', 'Applied', '2026-05-03')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const sameMonthPatternResult = buildCompanyCards(
      {
        trackerRows: [
          row(241, 'SeverityHashCo', 'Applied', '2026-05-03'),
          row(242, 'SeverityHashCo', 'Applied', '2026-05-10'),
        ],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: sameMonthSingleSignals } = buildNoResponseFrictionSignals(sameMonthSingleResult, fixedOpts);
    const { records: sameMonthPatternSignals } = buildNoResponseFrictionSignals(sameMonthPatternResult, fixedOpts);
    check(sameMonthSingleSignals[0]?.severity === 'single' && sameMonthPatternSignals[0]?.severity === 'pattern', 'severity/hash fixture: single vs pattern severity actually differs (precondition)');
    check(sameMonthSingleSignals[0]?.observedAt === sameMonthPatternSignals[0]?.observedAt, 'severity/hash fixture: both anchor to the same observedAt month (precondition)');
    check(sameMonthSingleSignals[0]?.sourceHash === sameMonthPatternSignals[0]?.sourceHash, 'sourceHash is identical for the same companyKey+observedAt despite different severity (single vs pattern) — fixes the dedup-breaking bug from PR #2788 review');

    // no record for responded-before / mixed / no-history cards — only
    // silent-on-you triggers this signal.
    const noSignalResult = buildCompanyCards(
      {
        trackerRows: [
          row(210, 'RespondedNoSignalCo', 'Rejected', '2026-06-01'),
          row(211, 'MixedNoSignalCo', 'Applied', '2026-01-01'),
          row(212, 'MixedNoSignalCo', 'Rejected', '2026-06-20'),
          row(213, 'NoHistoryNoSignalCo', 'Evaluated', '2026-06-01'),
        ],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    const labelsPresent = noSignalResult.companies.map(c => c.responsiveness.label);
    check(labelsPresent.includes('responded-before') && labelsPresent.includes('mixed') && labelsPresent.includes('no-history'), 'no-signal fixture actually exercises responded-before, mixed, and no-history cards');
    const { records: noSignals } = buildNoResponseFrictionSignals(noSignalResult, fixedOpts);
    check(noSignals.length === 0, 'responded-before, mixed, and no-history cards emit zero no-response-friction records');

    // running WITHOUT --emit-signal semantics: buildNoResponseFrictionSignals
    // is only ever invoked by the CLI when the flag is passed (verified by
    // reading the CLI wiring above); at the pure-function level, confirm the
    // emitted records carry exactly the ratified 10-field schema-v1 shape —
    // no free text (notes), no candidate name, nothing extra, nothing
    // missing.
    const allEmitted = [...singleSignals, ...patternSignals];
    for (const record of allEmitted) {
      const keys = Object.keys(record).sort();
      check(
        JSON.stringify(keys) === JSON.stringify([
          'companyKey', 'detail', 'emittedBy', 'observedAt', 'postingChannel', 'region',
          'schemaVersion', 'severity', 'signalType', 'sourceDetector', 'sourceHash',
        ]),
        'emitted record carries the ratified schema-v1 10 fields plus the additive postingChannel field (#3010), nothing extra (no notes/name leakage), nothing missing',
      );
    }

    // sourceHash is deterministic (dedup-safe): rebuilding the same fixture
    // twice must produce the same hash for the same underlying fact.
    const { records: singleSignalsAgain } = buildNoResponseFrictionSignals(
      buildCompanyCards(
        { trackerRows: [row(200, 'SingleSilentCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
        { now: NOW, silenceWindowDays: 28 },
      ),
      fixedOpts,
    );
    check(singleSignalsAgain[0]?.sourceHash === singleSignals[0]?.sourceHash, 'sourceHash is deterministic across repeated runs against the same fact (dedup-safe)');

    // sourceHash must actually be sensitive to companyKey and observedAt —
    // determinism alone doesn't prove the hash isn't a constant or doesn't
    // silently drop one of its inputs (CodeRabbit, PR #2788).
    const { records: differentCompanySignals } = buildNoResponseFrictionSignals(
      buildCompanyCards(
        { trackerRows: [row(203, 'DifferentCompanyCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
        { now: NOW, silenceWindowDays: 28 },
      ),
      fixedOpts,
    );
    check(differentCompanySignals[0]?.sourceHash !== singleSignals[0]?.sourceHash, 'sourceHash differs when companyKey differs (same observedAt month) — companyKey is a real hash input, not dropped');

    const { records: differentMonthSignals } = buildNoResponseFrictionSignals(
      buildCompanyCards(
        { trackerRows: [row(204, 'SingleSilentCo', 'Applied', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
        { now: NOW, silenceWindowDays: 28 },
      ),
      fixedOpts,
    );
    check(differentMonthSignals[0]?.sourceHash !== singleSignals[0]?.sourceHash, 'sourceHash differs when observedAt differs (same companyKey) — observedAt is a real hash input, not dropped');

    // severity excludes stale facts from the count unless --include-stale is
    // passed — a card with one active + one stale silent fact must report
    // 'single', matching what the 'silent-on-you' label itself was computed
    // from (computeResponsiveness excludes stale facts from the label too).
    const staleRows = [
      row(220, 'ActivePlusStaleCo', 'Applied', '2026-06-01'), // active: well within 365d
      row(221, 'ActivePlusStaleCo', 'Applied', '2024-01-01'), // stale: >365d before NOW
    ];
    const activePlusStaleResult = buildCompanyCards(
      { trackerRows: staleRows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(activePlusStaleResult.companies[0].responsiveness.label === 'silent-on-you', 'active+stale fixture: label is silent-on-you (only the active fact drives it)');
    const activePlusStaleFacts = activePlusStaleResult.companies[0].responsiveness.facts;
    check(activePlusStaleFacts.some(f => f.stale) && activePlusStaleFacts.some(f => !f.stale), 'active+stale fixture: card carries both a stale and an active silent fact');
    const { records: activePlusStaleSignals } = buildNoResponseFrictionSignals(activePlusStaleResult, fixedOpts);
    check(activePlusStaleSignals.length === 1, 'active+stale fixture: still exactly one record for the card');
    check(activePlusStaleSignals[0]?.severity === 'single', 'active+stale fixture: severity is single — the stale fact does not inflate it to pattern, matching the label');

    // The includeStale:true emission path must actually be exercised
    // end-to-end (not just the default-exclusion path above), so a
    // regression in the opt-in branch would be caught (CodeRabbit, PR #2788).
    const activePlusStaleIncludeStaleResult = buildCompanyCards(
      { trackerRows: staleRows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28, includeStale: true },
    );
    const { records: activePlusStaleIncludeStaleSignals } = buildNoResponseFrictionSignals(
      activePlusStaleIncludeStaleResult,
      { ...fixedOpts, includeStale: true },
    );
    check(activePlusStaleIncludeStaleSignals[0]?.severity === 'pattern', 'active+stale fixture with includeStale:true: severity is pattern — the stale fact now counts');

    // silentFactObservedAt returning null (unusable appliedDate) must skip the
    // card entirely — no record, no crash. Constructed directly rather than
    // through buildCompanyCards, since computeResponsiveness() never produces
    // a fact with an unparsable appliedDate in the first place.
    const unusableDateResult = {
      companies: [{
        key: 'unusable-date-co',
        responsiveness: {
          label: 'silent-on-you',
          facts: [{ num: 1, appliedDate: 'not-a-real-date', silentDays: 40, stale: false }],
        },
      }],
    };
    const { records: unusableDateSignals } = buildNoResponseFrictionSignals(unusableDateResult, fixedOpts);
    check(unusableDateSignals.length === 0, 'a card whose anchor fact has an unusable appliedDate is skipped entirely — no record emitted');

    // Mixed valid/invalid facts: the unusable-date fact must be filtered out
    // BEFORE anchor selection and severity counting, not merely tolerated by
    // whichever fact happens to win the reduce — otherwise it could win the
    // anchor outright, or (even when the valid fact wins) still inflate
    // severity to 'pattern' despite contributing no usable observation
    // (CodeRabbit, PR #2788).
    const mixedValidityResult = {
      companies: [{
        key: 'mixed-validity-co',
        responsiveness: {
          label: 'silent-on-you',
          facts: [
            { num: 1, appliedDate: '2026-06-01', silentDays: 40, stale: false },
            { num: 2, appliedDate: 'not-a-real-date', silentDays: 40, stale: false },
          ],
        },
      }],
    };
    const { records: mixedValiditySignals } = buildNoResponseFrictionSignals(mixedValidityResult, fixedOpts);
    check(mixedValiditySignals.length === 1, 'mixed valid/invalid facts: still exactly one record — the invalid fact does not block emission');
    check(mixedValiditySignals[0]?.observedAt === '2026-06', 'mixed valid/invalid facts: observedAt anchors on the valid fact');
    check(mixedValiditySignals[0]?.severity === 'single', 'mixed valid/invalid facts: severity is single — the invalid fact does not count toward pattern');

    // silentFactObservedAt must trim appliedDate before slicing, not just
    // before validating: parseDate() tolerates surrounding whitespace, but a
    // whitespace-padded appliedDate sliced without trimming would produce a
    // malformed observedAt (leading space, wrong characters) instead of the
    // clean YYYY-MM the schema requires.
    const paddedDateResult = {
      companies: [{
        key: 'padded-date-co',
        responsiveness: {
          label: 'silent-on-you',
          facts: [{ num: 1, appliedDate: ' 2026-06-01 ', silentDays: 40, stale: false }],
        },
      }],
    };
    const { records: paddedDateSignals } = buildNoResponseFrictionSignals(paddedDateResult, fixedOpts);
    check(paddedDateSignals[0]?.observedAt === '2026-06', 'a whitespace-padded appliedDate still produces a clean YYYY-MM observedAt');

    // anchor selection compares appliedDate, not tracker row num: a lower-num
    // row with a MORE RECENT appliedDate (a backfilled/out-of-order entry)
    // must still win the anchor, keeping observedAt tied to the true
    // most-recent application.
    const outOfOrderRows = [
      row(230, 'OutOfOrderCo', 'Applied', '2026-06-01'), // lower num, more recent applied date
      row(231, 'OutOfOrderCo', 'Applied', '2026-01-01'), // higher num, older applied date
    ];
    const outOfOrderResult = buildCompanyCards(
      { trackerRows: outOfOrderRows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: outOfOrderSignals } = buildNoResponseFrictionSignals(outOfOrderResult, fixedOpts);
    check(outOfOrderSignals[0]?.observedAt === '2026-06', 'anchor fact is chosen by appliedDate (2026-06-01), not by the larger tracker row num (231, dated 2026-01-01)');

    // anchor selection must trim before comparing: an untrimmed whitespace-
    // padded date can sort incorrectly against a clean neighbor and select
    // the wrong (older) anchor (CodeRabbit, PR #2788).
    const paddedAnchorRows = [
      row(240, 'PaddedAnchorCo', 'Applied', ' 2026-06-01 '), // padded, actually most recent
      row(241, 'PaddedAnchorCo', 'Applied', '2026-05-01'),   // clean, actually older
    ];
    const paddedAnchorResult = buildCompanyCards(
      { trackerRows: paddedAnchorRows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: paddedAnchorSignals } = buildNoResponseFrictionSignals(paddedAnchorResult, fixedOpts);
    check(paddedAnchorSignals[0]?.observedAt === '2026-06', 'anchor selection trims before comparing, so a whitespace-padded but more-recent appliedDate still wins over a clean but older one');

    // resolveRegion / resolveEmittedBy degrade gracefully against a missing file.
    // Per artemtrofymenko's PR #2788 review, an unresolvable region no longer
    // returns the literal string 'unknown' (which would imply a real
    // `unknown/` shared-layer directory) — it returns null instead, and the
    // caller (buildNoResponseFrictionSignals, tested below) is responsible
    // for turning that into "skip emission + warn", not a placeholder value.
    check(resolveRegion(join(CAREER_OPS, '__does-not-exist__.yml')) === null, 'resolveRegion degrades to null (not the string "unknown") when profile.yml is absent');
    check(resolveEmittedBy(join(CAREER_OPS, '__does-not-exist__.json')) === 'career-ops', 'resolveEmittedBy degrades to a version-less string when package.json is unreadable');

    // resolveRegion: a mapped country goes through COUNTRY_REGION_MAP, and an
    // unmapped country degrades to a slugified `unmapped/<slug>` rather than
    // crashing or falling all the way back to null.
    const regionTmpDir = mkdtempSync(join(tmpdir(), 'company-history-region-test-'));
    try {
      const mappedProfilePath = join(regionTmpDir, 'mapped-profile.yml');
      writeFileSync(mappedProfilePath, 'location:\n  country: Canada\n');
      check(resolveRegion(mappedProfilePath) === 'north-america/canada', 'resolveRegion maps a known country via COUNTRY_REGION_MAP');

      const unmappedProfilePath = join(regionTmpDir, 'unmapped-profile.yml');
      writeFileSync(unmappedProfilePath, 'location:\n  country: Narnia\n');
      check(resolveRegion(unmappedProfilePath) === 'unmapped/narnia', 'resolveRegion degrades an unmapped country to unmapped/<slug>, not null');

      // Region-resolution-failure -> skip-emission-with-warning (Finding 3,
      // PR #2788 review): a profile with no resolvable region must not crash
      // the tool and must not emit a misleading 'unknown' record — it emits
      // zero records for that run plus a warning naming the skipped company.
      // A second company/report with a resolvable region (fixedOpts, used
      // throughout this test block) still gets its record — proven by every
      // other assertion in this section, which all pass a resolvable region.
      const noRegionProfilePath = join(regionTmpDir, 'no-region-profile.yml');
      writeFileSync(noRegionProfilePath, 'someOtherKey: true\n');
      const noRegionResult = buildCompanyCards(
        { trackerRows: [row(250, 'NoRegionCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
        { now: NOW, silenceWindowDays: 28 },
      );
      const { records: noRegionSignals, warnings: noRegionWarnings } = buildNoResponseFrictionSignals(
        noRegionResult,
        { profilePath: noRegionProfilePath, emittedBy: 'career-ops vTEST' },
      );
      check(noRegionSignals.length === 0, 'unresolvable region: no no-response-friction record emitted, no crash');
      check(noRegionWarnings.length === 1 && noRegionWarnings[0].includes(noRegionResult.companies[0].key), 'unresolvable region: exactly one warning naming the skipped companyKey');
    } finally {
      rmSync(regionTmpDir, { recursive: true, force: true });
    }
  }

  // --- postingChannel field (#3010): derived from the tracker's own `via` ---
  {
    // agency-tagged via -> staffing-agency.
    const agencyResult = buildCompanyCards(
      { trackerRows: [{ ...row(260, 'AgencyPostedCo', 'Applied', '2026-05-01'), via: 'Hays' }], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(agencyResult.companies[0].responsiveness.facts[0].via === 'Hays', 'row.via survives onto the silent fact');
    const { records: agencySignals } = buildNoResponseFrictionSignals(agencyResult, { region: 'north-america/canada', emittedBy: 'career-ops vTEST' });
    check(agencySignals[0]?.postingChannel === 'staffing-agency', 'a tagged agency via value emits postingChannel: staffing-agency');

    // em-dash via (tracker's own "confirmed direct" convention) -> direct-employer.
    const directResult = buildCompanyCards(
      { trackerRows: [{ ...row(261, 'DirectConfirmedCo', 'Applied', '2026-05-01'), via: '—' }], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: directSignals } = buildNoResponseFrictionSignals(directResult, { region: 'north-america/canada', emittedBy: 'career-ops vTEST' });
    check(directSignals[0]?.postingChannel === 'direct-employer', 'an em-dash via value (confirmed direct, no agency) emits postingChannel: direct-employer');

    // absent/blank via -> unknown (never guessed as direct-employer).
    const noDataResult = buildCompanyCards(
      { trackerRows: [row(262, 'NoViaDataCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const { records: noDataSignals } = buildNoResponseFrictionSignals(noDataResult, { region: 'north-america/canada', emittedBy: 'career-ops vTEST' });
    check(noDataSignals[0]?.postingChannel === 'unknown', 'a row with no recorded via emits postingChannel: unknown, never a guessed direct-employer');

    check(resolvePostingChannel('  ') === 'unknown', 'resolvePostingChannel: whitespace-only via is unknown, not staffing-agency');
    check(resolvePostingChannel(null) === 'unknown', 'resolvePostingChannel: null via is unknown');
    check(resolvePostingChannel(undefined) === 'unknown', 'resolvePostingChannel: undefined via is unknown');
    check(resolvePostingChannel('Acme Staffing') === 'staffing-agency', 'resolvePostingChannel: any non-em-dash tagged agency name is staffing-agency');
    check(resolvePostingChannel('—') === 'direct-employer', 'resolvePostingChannel: exact em-dash is direct-employer');
  }

  console.log(`\n  company-history self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (isMainModule(import.meta.url)) {
  const { summaryMode, selfTestMode, company, silenceWindowArg, includeStale, scanHistoryOverride, followupsOverride, emitSignal } =
    parseArgs(process.argv);

  if (selfTestMode) {
    runSelfTest().catch(err => {
      console.error(`company-history.mjs: self-test error: ${err?.message || err}`);
      process.exit(1);
    });
  } else {
    const run = async () => {
      const tracker = loadTrackerRows(CAREER_OPS);
      const followups = loadFollowupRows(CAREER_OPS, followupsOverride);
      const scanHistory = loadRepostClusters(CAREER_OPS, scanHistoryOverride);
      const statusLog = await loadStatusLogSource();

      // parseArgs already validated the flag as a positive integer.
      const silenceWindowDays = silenceWindowArg !== undefined
        ? parseInt(silenceWindowArg, 10)
        : resolveDefaultSilenceWindow(CAREER_OPS);

      const result = buildCompanyCards(
        {
          trackerRows: tracker.rows,
          followupRows: followups.rows,
          repostClusters: scanHistory.clusters,
          aggregators: scanHistory.aggregators,
          sourcesLoaded: {
            tracker: tracker.loaded,
            followups: followups.loaded,
            scanHistory: scanHistory.loaded,
            statusLog: statusLog.loaded,
          },
          statusLogAppliedByNum: statusLog.appliedDateByNum,
          medianResponseDays: statusLog.medianResponseDays,
        },
        { silenceWindowDays, includeStale },
      );

      if (company) {
        console.log(JSON.stringify(getCompanyCard(result, company), null, 2));
      } else if (summaryMode) {
        console.log(renderSummary(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }

      // --emit-signal is additive and opt-in only: without the flag, output
      // above is byte-for-byte identical to pre-#2787 behavior. parseArgs()
      // already rejects --emit-signal unless it's paired with --summary (and
      // without --company), so by the time we get here `summaryMode` is true
      // and the human-readable renderSummary() text — not a JSON document —
      // is what the signal records get appended after; stdout stays a single
      // parsable unit for whichever format was actually printed. When passed,
      // RFC #1506 schema-v1 no-response-friction records print as JSON Lines
      // (one record per line) after the normal output — nothing is written to
      // disk and nothing is published anywhere.
      if (emitSignal) {
        const { records: signals, warnings } = buildNoResponseFrictionSignals(result, { includeStale });
        for (const warning of warnings) {
          console.error(`company-history.mjs: ${warning}`);
        }
        for (const record of signals) {
          console.log(JSON.stringify(record));
        }
      }
    };

    run().catch(err => {
      console.error(`company-history.mjs: unexpected error: ${err?.message || err}`);
      process.exit(1);
    });
  }
}
