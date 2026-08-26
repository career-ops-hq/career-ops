// tests/local-today-gates.test.mjs — every place that asks "what day is it"
// must answer with the LOCAL calendar day, not the UTC one (#3070).
//
// #2765 fixed followup-seed, #2932 fixed set-status's two. These are the rest,
// and each GATES a decision rather than stamping a filename:
//
//   scan.mjs                 `today < cooldownUntil` — a posting the user
//                            silenced until a date resurfaces a day early
//   followup-cadence.mjs     the follow-up due decision
//   check-table-freshness    `expired`, which exits 1 — a CI gate
//   funnel-velocity.mjs      the "waiting" figure
//   company-history.mjs      the `now` all age math runs against
//   assessment-log.mjs       the date written into a user's assessments.tsv row
//
// PINNED INSTANT, not the wall clock. The window where the UTC day and the
// local day disagree only exists for part of the UTC day, so a test that reads
// `new Date()` passes for most of the day regardless of the bug — which is how
// this survived two previous fixes.
//
// Run:  node --test tests/local-today-gates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localToday } from '../lib/local-today.mjs';
import { shouldDedupScanHistoryRow } from '../scan.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// A module path embedded in a child script must be a file:// URL. On Windows a
// bare join() yields `D:\a\career-ops\...`, which is neither a valid ESM
// specifier nor safe inside a quoted JS string — the backslashes read as escape
// sequences. POSIX absolute paths happen to work, which is why this only ever
// reddens on the Windows leg.
const spec = (rel) => pathToFileURL(join(ROOT, rel)).href;

// 01:30 UTC: still the previous day everywhere west of Greenwich.
const INSTANT = '2026-08-18T01:30:00Z';
const UTC_DAY = '2026-08-18';
const NY_DAY = '2026-08-17';

/**
 * Evaluate an expression in a child pinned to a timezone AND a frozen clock.
 *
 * Freezing matters more than the timezone. Without it these assertions compare
 * whatever `new Date()` returns during the run, so they agree with the UTC day
 * for most of the day and pass whether the fix is present or not — a test that
 * measures nothing for 20-odd hours out of 24. The first draft of this file did
 * exactly that and passed with the fix reverted.
 *
 * `Date` is replaced before the module under test is imported, and the default
 * parameters being tested read the clock at CALL time, so the freeze reaches
 * them.
 *
 * `instant` defaults to INSTANT, the day-boundary pair every gate above needs.
 * A caller pinning a WEEK boundary passes its own — a day apart is not enough
 * to move an ISO week.
 */
function inFrozenTz(tz, expr, instant = INSTANT) {
  const preamble =
    `const RealDate = Date;` +
    `const FROZEN = new RealDate('${instant}');` +
    `globalThis.Date = class extends RealDate {` +
    `  constructor(...a) { if (a.length === 0) { super(FROZEN.getTime()); } else { super(...a); } }` +
    `  static now() { return FROZEN.getTime(); }` +
    `};`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', preamble + expr], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, TZ: tz },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}

test('the frozen clock actually takes effect in the child', () => {
  // Without this, a broken freeze would make every assertion below vacuous.
  const out = inFrozenTz('America/New_York', `process.stdout.write(new Date().toISOString());`);
  assert.equal(out, new Date(INSTANT).toISOString(), 'the clock was not frozen in the child');
});

test('the premise: at this instant the UTC day is tomorrow in New York', () => {
  // If this ever stops holding, every assertion below is vacuous rather than
  // wrong, so it is asserted rather than assumed.
  const fmt = (tz) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(INSTANT));
  assert.equal(fmt('UTC'), UTC_DAY);
  assert.equal(fmt('America/New_York'), NY_DAY);
  assert.notEqual(fmt('UTC'), fmt('America/New_York'));
});

test('localToday resolves the local day, not the UTC one', () => {
  const out = inFrozenTz('America/New_York',
    `import {localToday} from '${spec('lib/local-today.mjs')}';` +
    `const i=new Date('${INSTANT}');` +
    `process.stdout.write(localToday(i)+' '+i.toISOString().slice(0,10));`);
  assert.equal(out, `${NY_DAY} ${UTC_DAY}`);
});

// Explicit `today`, so this pins the FUNCTION's comparison rather than the
// default. The default is covered separately below, under a frozen clock.
test('scan: a cooldown compares against the day it is given', () => {
  // The user silenced this posting until UTC_DAY. On NY_DAY it must stay
  // silenced; resolving "today" as the UTC day opened it early.
  const row = { firstSeen: '2026-01-01', status: `cooldown:${UTC_DAY}` };
  assert.equal(shouldDedupScanHistoryRow(row, { today: NY_DAY }), true, 'cooldown opened a day early');
  assert.equal(shouldDedupScanHistoryRow(row, { today: UTC_DAY }), false, 'cooldown did not open on its date');
});

test('scan: the recheck window is measured from the day it is given', () => {
  const row = { firstSeen: '2026-08-11', status: 'added' };
  // 6 local days elapsed, 7 UTC days. With a 7-day recheck the row is NOT yet
  // due; reading the UTC day made it due a day early.
  assert.equal(shouldDedupScanHistoryRow(row, { recheckAfterDays: 7, today: NY_DAY }), true, 'rechecked a day early');
  assert.equal(shouldDedupScanHistoryRow(row, { recheckAfterDays: 7, today: UTC_DAY }), false);
});

test("scan's DEFAULT today is the local day, so a cooldown holds", () => {
  // The cooldown runs to the UTC day. Under the frozen clock the local day is
  // still the day before, so the default must keep the posting silenced —
  // resolving the default as the UTC day opened it a day early.
  const out = inFrozenTz('America/New_York',
    `const {shouldDedupScanHistoryRow} = await import('${spec('scan.mjs')}');` +
    `const held = shouldDedupScanHistoryRow({firstSeen:'2026-01-01',status:'cooldown:${UTC_DAY}'});` +
    `process.stdout.write(String(held));`);
  assert.equal(out, 'true', 'the default today opened the cooldown a day early');
});

test('company-history today() is the local calendar day at UTC midnight', () => {
  // The UTC-midnight ANCHOR is deliberate and must survive; only WHICH day
  // moves. #2765 drew the same line, so both halves are asserted.
  const out = inFrozenTz('America/New_York',
    `const {today} = await import('${spec('company-history.mjs')}');` +
    `process.stdout.write(today().toISOString());`);
  assert.equal(out.slice(0, 10), NY_DAY, `today() returned the UTC day (${out.slice(0, 10)}), not the local one`);
  assert.equal(out.slice(10), 'T00:00:00.000Z', 'the UTC-midnight anchor was lost');
});

test('check-table-freshness --today still overrides, and reports the date it used', () => {
  // The flag is the deterministic escape hatch; the local-day default must not
  // have broken it, or every CI pin in the repo silently drifts.
  const r = spawnSync(process.execPath, [join(ROOT, 'check-table-freshness.mjs'), '--today', '2026-08-18'], {
    cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  assert.equal(r.error, undefined);
  assert.ok(r.stdout.includes('2026-08-18'), `--today was not honoured: ${r.stdout.slice(0, 200)}`);
});

// ── The other side of the comparison: who WRITES first_seen ────────────────
//
// Everything above pins READERS. But shouldDedupScanHistoryRow measures the
// recheck window as `daysBetweenIsoDates(firstSeen, today)`, and firstSeen is
// whatever a scanner stamped into scan-history.tsv. Moving only the reader to
// the local day did not make that comparison correct — it put the two sides on
// different clocks, and left one file carrying rows written on both.
//
// The invariant is already established for the dashboard's spawned scan child
// (web/tests/lib/pipeline-local-today.test.mjs asserts `const date =
// localToday();` reaches appendToScanHistory there). This is the same assertion
// for the engine-side scanners, which were never covered.
//
// Source-level on purpose: the value is a local const inside a scanner's main(),
// reachable only by running a real scan. What can be checked cheaply is that no
// call site hands the writer a UTC-derived day — which is the whole defect.
test('every appendToScanHistory call site is handed a local-day value', () => {
  const callers = ['scan.mjs', 'scan-ats-full.mjs', 'scan-hn.mjs', 'scan-interamt.mjs'];
  const CALL = 'appendToScanHistory(';
  const offenders = [];

  for (const file of callers) {
    const src = readFileSync(join(ROOT, file), 'utf8');

    // The day argument is the only date-shaped argument the writer takes, so a
    // toISOString() anywhere in a call site's argument list is the bug. This
    // deliberately does NOT scan the whole file: scan.mjs uses toISOString()
    // legitimately elsewhere for UTC-midnight round-tripping, which
    // lib/local-today.mjs's own docstring blesses.
    // Whole-source with balanced parens, NOT line by line, and NOT a
    // `([^)]*)` capture. Both of the obvious shortcuts miss a real reintroduction:
    //
    //   `([^)]*)`   stops at the `)` closing `new Date()`, so the inline form
    //               `appendToScanHistory(offers, new Date().toISOString()...)`
    //               reads as `offers, new Date(` and passes. (It did — the
    //               first draft of this guard let scan-hn.mjs through.)
    //   per-line    misses a wrapped call, where the offending argument sits on
    //               a different line from the callee.
    //
    // Paren counting here ignores parens inside strings and comments. That is
    // acceptable for this narrow job — matching the argument list of one known
    // function in four known files — and a miscount can only widen the slice,
    // never narrow it, so it cannot hide an offender.
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;

    for (let from = 0; ; ) {
      const at = src.indexOf(CALL, from);
      if (at === -1) break;
      from = at + 1;
      if (/export\s+async\s+function\s+$/.test(src.slice(Math.max(0, at - 40), at))) continue;

      const open = at + CALL.length - 1;
      let depth = 0;
      let end = src.length;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')' && --depth === 0) { end = i; break; }
      }
      const args = src.slice(open + 1, end);
      if (/toISOString/.test(args)) {
        offenders.push(`${file}:${lineOf(at)} — appendToScanHistory(${args.replace(/\s+/g, ' ').trim()})`);
      }
    }

    // A call site passing a bare `date` identifier is only correct if that
    // identifier came from localToday(). Catch the assignment too, or moving the
    // UTC expression one line up defeats the check above. Read to the
    // terminating `;` so a wrapped assignment is covered as well.
    const assign = /(?:^|\n)[^\S\n]*const[^\S\n]+date[^\S\n]*=/g;
    for (let m; (m = assign.exec(src)); ) {
      const start = m.index + m[0].length;
      const semi = src.indexOf(';', start);
      const expr = src.slice(start, semi === -1 ? src.length : semi);
      if (/toISOString/.test(expr)) {
        offenders.push(`${file}:${lineOf(m.index + 1)} — const date =${expr.replace(/\s+/g, ' ')};`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'scan-history first_seen must be stamped with localToday(), not the UTC day — '
    + `shouldDedupScanHistoryRow compares it against the LOCAL day (#3070):\n  ${offenders.join('\n  ')}`,
  );
});

test('each scanner that writes scan-history imports localToday', () => {
  // The check above is satisfied by deleting the date argument entirely. This
  // asserts the replacement is actually present.
  for (const file of ['scan.mjs', 'scan-ats-full.mjs', 'scan-hn.mjs', 'scan-interamt.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(
      src, /import\s*{[^}]*\blocalToday\b[^}]*}\s*from\s*['"][^'"]*local-today\.mjs['"]/,
      `${file} writes scan-history.tsv but does not import localToday`,
    );
  }
});


// ── Reporting windows: which day it is decides which WEEK, and which
//    threshold has elapsed ──────────────────────────────────────────────
//
// Both of these gate a decision the same way scan's cooldown does, and both
// were still reading the UTC day.

// A Monday 01:30 UTC. In New York it is still the SUNDAY before — so the two
// readings fall in different ISO weeks, not merely on different days. INSTANT
// above is a Tuesday/Monday pair inside one week, which cannot see this.
const WEEK_INSTANT = '2026-08-17T01:30:00Z';

test('the week premise: this instant is a different ISO week in New York', () => {
  const fmt = (tz) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(WEEK_INSTANT));
  assert.equal(fmt('UTC'), '2026-08-17', 'UTC: Monday');
  assert.equal(fmt('America/New_York'), '2026-08-16', 'New York: the Sunday before');
});

test('weekly-digest: "this week" is the week the caller is actually in', () => {
  // Reading getUTCDate() here returned the week that had not started yet, so
  // every session logged Mon-Sun fell outside inRange() and the digest for the
  // week just ended came back empty — which reads as a quiet week, not as a
  // wrong window.
  const out = inFrozenTz('America/New_York',
    `const {computeDefaultRange} = await import('${spec('weekly-digest.mjs')}');` +
    `process.stdout.write(JSON.stringify(computeDefaultRange()));`,
    WEEK_INSTANT);
  assert.deepEqual(JSON.parse(out), { from: '2026-08-10', to: '2026-08-16' },
    'the digest defaulted to a week the user is not in yet');
});

test('weekly-digest: an explicit `now` is resolved locally too', () => {
  const out = inFrozenTz('America/New_York',
    `const {computeDefaultRange} = await import('${spec('weekly-digest.mjs')}');` +
    `process.stdout.write(JSON.stringify(computeDefaultRange(new Date('${WEEK_INSTANT}'))));`,
    WEEK_INSTANT);
  assert.deepEqual(JSON.parse(out), { from: '2026-08-10', to: '2026-08-16' });
});

test('rejection-latency: the courtesy threshold is measured from the local day', () => {
  // daysBetween() reduces both operands to their UTC date, so a bare `new Date()`
  // default counted one extra day all evening. This interview is exactly
  // courtesyDays old on the LOCAL day and one day over it on the UTC day, and
  // the gate is `daysAll <= courtesyDays` — so the UTC reading crosses it and
  // emits a ready-to-copy data/blacklist.md row for a company whose courtesy
  // window has not actually elapsed, stamped with tomorrow's date.
  const active = [
    '| Company | Role | Round | Date | Interviewer | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    '| Acme Corp | Backend Engineer | Round 1 | 2026-07-18 | Panel | Done | final round |',
  ].join('\n');
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme Corp | Backend Engineer | 4.2/5 | Interview | ❌ | — | waiting |',
  ].join('\n');

  const out = inFrozenTz('America/New_York',
    `const q = await import('${spec('process-quality.mjs')}');const m = await import('${spec('rejection-latency.mjs')}');` +
    `const rows = q.parseActiveInterviews(${JSON.stringify(active)});` +
    `const tr = m.parseTrackerInterviewRows(${JSON.stringify(tracker)});` +
    // No `today` — the default is what is under test.
    `const r = m.computeRejectionLatency(rows, tr, { courtesyDays: 30 });` +
    `process.stdout.write(JSON.stringify(r.flags.map(f => [f.company, f.daysSinceLastInterview])));`);

  assert.deepEqual(JSON.parse(out), [],
    'flagged a company 30 local days after its last round, one day before the courtesy window elapses');
});

test('rejection-latency still flags once the local window HAS elapsed', () => {
  // The other side of the same boundary — without it, "never flag at all" would
  // satisfy the test above just as well.
  const active = [
    '| Company | Role | Round | Date | Interviewer | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    '| Acme Corp | Backend Engineer | Round 1 | 2026-07-16 | Panel | Done | final round |',
  ].join('\n');
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme Corp | Backend Engineer | 4.2/5 | Interview | ❌ | — | waiting |',
  ].join('\n');

  const out = inFrozenTz('America/New_York',
    `const q = await import('${spec('process-quality.mjs')}');const m = await import('${spec('rejection-latency.mjs')}');` +
    `const rows = q.parseActiveInterviews(${JSON.stringify(active)});` +
    `const tr = m.parseTrackerInterviewRows(${JSON.stringify(tracker)});` +
    `const r = m.computeRejectionLatency(rows, tr, { courtesyDays: 30 });` +
    `process.stdout.write(JSON.stringify(r.flags.map(f => [f.daysSinceLastInterview, f.blacklistSuggestion])));`);

  const flags = JSON.parse(out);
  assert.equal(flags.length, 1, 'a genuinely elapsed window must still flag');
  assert.equal(flags[0][0], 32, 'elapsed days counted from the local day');
  assert.ok(flags[0][1].includes(`| ${NY_DAY} |`),
    `the blacklist suggestion is dated with the UTC day: ${flags[0][1]}`);
});
