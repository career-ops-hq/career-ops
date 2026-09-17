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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localToday } from '../lib/local-today.mjs';
import { isNestedCheckout } from '../lib/mjs-files.mjs';
import { shouldDedupScanHistoryRow } from '../scan.mjs';
import { parseScanHistory, detectReposts } from '../detect-reposts.mjs';

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


// ── scan-history writers: four scanners, one file, one calendar ───────
//
// REPLACES the call-site guard added with the fix in cc241ea (#3070), which
// this subsumes. That one listed four files and looked for `toISOString` in a
// call's arguments or in a `const date =` assignment — a denylist over a fixed
// list. Measured against five reintroduction shapes it caught the first:
//
//   inline new Date().toISOString() in the call        CAUGHT
//   the same day via a differently-named variable      missed
//   a UTC day built without toISOString (getUTC*)      missed
//   localToday(<pinned instant>) instead of localToday()  missed
//   a fifth writer in a subdirectory                   missed
//
// So this asks the opposite question — not "does the argument look wrong" but
// "is the argument localToday()" — over writers discovered by walking the tree.
// The import check below is cc241ea's and is kept as it was.
//
// data/scan-history.tsv is appended to by FOUR scripts through the same
// exported helper — scan.mjs, scan-ats-full.mjs, scan-hn.mjs and
// scan-interamt.mjs. #3070 moved scan.mjs to the local day and left the other
// three on the UTC day, so a single evening west of Greenwich stamps two
// different dates into the same file.
//
// first_seen is not a cosmetic stamp. shouldDedupScanHistoryRow measures it
// against localToday(), and detect-reposts groups on it — its --min-span guard
// exists (its own header says so) "for anyone whose sweeps straddle midnight
// and land one company on two dates", which mixed stamping causes on every
// evening run rather than only at midnight.

/**
 * Whether the `/` at `i` opens a regex literal rather than being division.
 *
 * The classic heuristic — look at the last significant token before it. A regex
 * can only appear where a VALUE is expected, so an operator, an opening
 * bracket, a comma, a semicolon or a value-position keyword before it means
 * regex; an identifier, a number or a closing paren/bracket means division.
 * `}` is genuinely ambiguous (block end vs object literal end) and is read as
 * regex, the usual choice: over-reading here masks a few characters, while
 * under-reading lets a regex's contents open a phantom string frame, which is
 * the failure that hides code.
 */
function startsRegex(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const prev = src[j];
  if ('=(,:[!&|?{};+-*%~^<>'.includes(prev)) return true;
  // A `)` normally ends an expression, so `/` after it is division — except
  // when it closes a CONTROL condition, where a statement (and so a regex) may
  // follow: `if (enabled) /"/.test(value);`. Walk back to the matching `(` and
  // look at the keyword in front of it.
  if (prev === ')') {
    let depth = 0;
    let k = j;
    for (; k >= 0; k--) {
      if (src[k] === ')') depth++;
      else if (src[k] === '(' && --depth === 0) break;
    }
    if (k < 0) return false;
    let w = k - 1;
    while (w >= 0 && /\s/.test(src[w])) w--;
    let e = w;
    while (w >= 0 && /[A-Za-z0-9_$]/.test(src[w])) w--;
    return ['if', 'while', 'for', 'switch', 'catch', 'with'].includes(src.slice(w + 1, e + 1));
  }
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
    const word = src.slice(k + 1, j + 1);
    return ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
      'case', 'do', 'else', 'yield', 'await'].includes(word);
  }
  return false;
}

/**
 * A per-character map of which positions in `src` are CODE — string and
 * template TEXT and comments are not, but a template's `${...}` substitution
 * is, recursively.
 *
 * Not a JavaScript lexer, and deliberately not one: `test-all.mjs` states the
 * suite runs "on a fresh clone with only Node", so there is no parser
 * dependency available to a test here. This covers the constructs a
 * scan-history call is actually written with — the status string argument
 * (`'added'`, `'skipped_title'`), a commented-out call, and the template-string
 * child snippet the repo already uses to drive these writers
 * (web/src/lib/core/pipeline.ts builds one).
 *
 * Regex literals are NOT distinguished from division. A `/.../ ` argument to
 * appendToScanHistory would make the gate fail LOUDLY, which is the safe
 * direction for a sentinel and a signal to revisit this — never a silent pass.
 *
 * @param {string} src
 * @returns {boolean[]} isCode[i] for every index in src.
 */
function codeMask(src) {
  const mask = new Array(src.length).fill(true);
  // Bottom frame is the file itself. A `${` pushes a code frame whose parent is
  // the template it interpolates into; `braces` tracks object/block nesting so
  // the `}` that CLOSES the substitution is told apart from an inner one.
  const stack = [{ template: false, braces: 0 }];
  let i = 0;

  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const n = src[i + 1];

    if (top.template) {
      if (c === '\\') { mask[i++] = false; if (i < src.length) mask[i++] = false; continue; }
      if (c === '`') { mask[i++] = false; stack.pop(); continue; }
      if (c === '$' && n === '{') {
        mask[i++] = false;
        mask[i++] = false;
        stack.push({ template: false, braces: 0 });
        continue;
      }
      mask[i++] = false;
      continue;
    }

    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') mask[i++] = false;
      continue;
    }
    if (c === '/' && n === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close === -1 ? src.length : close + 2;
      while (i < stop) mask[i++] = false;
      continue;
    }
    if (c === "'" || c === '"') {
      mask[i++] = false;                                  // opening quote
      while (i < src.length) {
        if (src[i] === '\\') { mask[i++] = false; if (i < src.length) mask[i++] = false; continue; }
        const closing = src[i] === c;
        mask[i++] = false;
        if (closing) break;
      }
      continue;
    }
    if (c === '`') { mask[i++] = false; stack.push({ template: true }); continue; }
    if (c === '/' && startsRegex(src, i)) {
      // A regex literal's contents are DATA. Not masking them let a quote or a
      // backtick inside one open a phantom string or template frame that then
      // swallowed real code — scan-hn.mjs carries `/```yaml|```/g`, six
      // backticks, which is that hazard live in a writer file today.
      mask[i++] = false;                                  // opening slash
      let inClass = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '\\') { mask[i++] = false; if (i < src.length) mask[i++] = false; continue; }
        if (ch === '\n') break;                            // unterminated; stop rather than run away
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { mask[i++] = false; break; }
        mask[i++] = false;
      }
      while (i < src.length && /[a-z]/.test(src[i])) mask[i++] = false;   // flags
      continue;
    }
    if (c === '{') { top.braces++; i++; continue; }
    if (c === '}') {
      const closesSubstitution = top.braces === 0 && stack.length > 1 && stack[stack.length - 2].template;
      if (closesSubstitution) { mask[i++] = false; stack.pop(); continue; }
      if (top.braces > 0) top.braces--;
      i++;
      continue;
    }
    i++;
  }
  return mask;
}

/** Whether every character of `src.slice(from, to)` is code. */
const isCodeRange = (isCode, from, to) => isCode.slice(from, to).every(Boolean);

/**
 * The argument list of every `appendToScanHistory(...)` CALL in `src`,
 * paren-matched over CODE positions only.
 *
 * `(?<!function )` skips the definition in scan.mjs — its own `date` parameter
 * is not stamped by anything and would read as an offender.
 */
function scanHistoryCallArgs(src) {
  const isCode = codeMask(src);
  const calls = [];
  for (const m of src.matchAll(/(?<!function )\bappendToScanHistory\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (!isCode[m.index]) continue;            // the name itself is in a string or comment
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (!isCode[i]) continue;
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) {
        calls.push({ list: src.slice(open + 1, i), isCode: isCode.slice(open + 1, i) });
        break;
      }
    }
  }
  return calls;
}

/** Split an argument list on TOP-LEVEL commas that are CODE, not string content. */
function topLevelArgs({ list, isCode }) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (!isCode[i]) continue;
    const c = list[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

/** Every .mjs source file in the repo, at any depth. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Vendored code, build output, and the suite's own scratch copy of the repo
    // (test-all.mjs mkdtemps it under ROOT) would otherwise be walked.
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|\.next|coverage|dist|build)$/.test(entry.name)) continue;
      if (entry.name.startsWith('.tmp-script-test-')) continue;
      // ...and so would git's OWN scratch copy of the repo. The `\.git` above
      // matches a directory NAME, which a linked worktree does not have — it
      // marks itself with a `.git` file. This gate read the worktree's stale
      // sources as repo source and failed, naming files that are correct on the
      // branch under test (#3499). Same hazard as the line above it, different
      // author of the second copy.
      if (isNestedCheckout(join(dir, entry.name))) continue;
      sourceFiles(join(dir, entry.name), acc);
    } else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

// The census above is only as good as its scanner, and every shape below was
// found by review rather than by the scanner's own tests. So the scanner gets
// tested too: masking the wrong region does not make the gate fail, it makes it
// pass while seeing less — the one failure mode a sentinel must not have.
test('the call scanner sees code and only code', () => {
  const call = (src) => scanHistoryCallArgs(src).map((c) => topLevelArgs(c)[1]);

  // Delimiters inside a string argument are not delimiters.
  assert.deepEqual(call('await appendToScanHistory(buildOffers(")"), localToday());'), ['localToday()']);
  assert.deepEqual(call('await appendToScanHistory("a,b", localToday());'), ['localToday()']);

  // Comments and template TEXT are not executed, so they hold no calls.
  assert.deepEqual(call('// appendToScanHistory(o, utc)\nawait appendToScanHistory(o, localToday());'), ['localToday()']);
  assert.deepEqual(call('const s = `appendToScanHistory(o, utc)`;'), []);

  // …but a substitution is executed, and pipeline.ts drives these writers from
  // exactly such a snippet.
  assert.deepEqual(call('const s = `${appendToScanHistory(o, utcDate)}`;'), ['utcDate']);
  assert.deepEqual(call('const s = `${appendToScanHistory(o, {a:{b:1}} ? d : d)}`;'), ['{a:{b:1}} ? d : d']);

  // A quote or backtick inside a REGEX must not open a phantom string frame and
  // swallow the call after it. scan-hn.mjs carries /```yaml|```/g today.
  assert.deepEqual(call("const p = /'/;\nawait appendToScanHistory(o, utcDate);"), ['utcDate']);
  assert.deepEqual(call('const p = /```yaml|```/g;\nawait appendToScanHistory(o, utcDate);'), ['utcDate']);
  assert.deepEqual(call('if (enabled) /"/.test(v);\nawait appendToScanHistory(o, utcDate);'), ['utcDate']);

  // …and division must still be division, or the mask eats real code instead.
  assert.deepEqual(call('const r = a / b; await appendToScanHistory(o, localToday());'), ['localToday()']);
  assert.deepEqual(call('const r = (a + b) / c; await appendToScanHistory(o, localToday());'), ['localToday()']);
});

test('the scanner resolves every call the four known writers contain', () => {
  // The shapes above are synthetic. This is the real files, and it is what
  // would catch masking that is correct in miniature and wrong at scale.
  for (const [file, expected] of [['scan.mjs', 5], ['scan-ats-full.mjs', 1], ['scan-hn.mjs', 1], ['scan-interamt.mjs', 5]]) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    const naive = [...src.matchAll(/(?<!function )\bappendToScanHistory\s*\(/g)].length;
    assert.equal(naive, expected, `${file}: expected ${expected} call sites, source has ${naive} — update this expectation deliberately`);
    assert.equal(scanHistoryCallArgs(src).length, expected, `${file}: the mask hid ${expected - scanHistoryCallArgs(src).length} call(s)`);
  }
});

test('every scan-history writer stamps the local day', () => {
  // DERIVED, not a hard-coded list: any future script that calls
  // appendToScanHistory is covered the day it is written, at any depth —
  // `scripts/scan-foo.mjs` counts, not just a direct child of ROOT. That is the
  // shape tests/lock-rm-contention.test.mjs used to finally pin its own family
  // shut after two reintroductions.
  const writers = sourceFiles(ROOT)
    .map((file) => ({ file, calls: scanHistoryCallArgs(readFileSync(file, 'utf-8')), src: readFileSync(file, 'utf-8') }))
    .filter((w) => w.calls.length > 0);

  assert.ok(writers.length >= 4, `expected at least the four known scan-history writers, found ${writers.map((w) => w.file).join(', ')}`);

  const offenders = [];
  for (const { file, calls, src } of writers) {
    const name = relative(ROOT, file);

    // Identifiers this file binds to localToday() WITH NO ARGUMENTS, so
    // `const date = localToday()` followed by `appendToScanHistory(offers, date)`
    // resolves. The empty parens are load-bearing: `localToday(new Date('2026-08-22'))`
    // is a pinned day, not today, and would otherwise be accepted here.
    // Masked, not raw: `// const scanDate = localToday()` in a comment would
    // otherwise bind scanDate here, and a real `appendToScanHistory(offers,
    // scanDate)` stamping a UTC day would then sail through.
    //
    // And EVERY binding of a name has to be localToday(), not just one. There
    // is no scope analysis here, so a module-level `const date = localToday()`
    // would otherwise vouch for a function-local `const date = <UTC day>` that
    // shadows it. Requiring unanimity rejects the shadowed case without needing
    // to resolve which binding a given call sees.
    const srcMask = codeMask(src);
    const bindings = new Map();                            // name -> Set of initializer texts
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
      if (!isCodeRange(srcMask, m.index, m.index + m[0].length)) continue;
      if (!bindings.has(m[1])) bindings.set(m[1], new Set());
      bindings.get(m[1]).add(m[2].trim());
    }
    const localDayVars = new Set(
      [...bindings.entries()]
        .filter(([, inits]) => [...inits].every((init) => /^localToday\s*\(\s*\)\s*;?$/.test(init)))
        .map(([name]) => name),
    );

    for (const call of calls) {
      // ASSERT ON THE ARGUMENT, not on whether localToday appears somewhere in
      // the file. A writer could call localToday() for something else entirely
      // and still stamp history with a UTC day — and a denylist of the two
      // toISOString spellings would not see a day derived any other way
      // (getUTCFullYear formatting, a helper, an imported constant).
      const stamped = topLevelArgs(call)[1];
      if (stamped === undefined || stamped === '') {
        offenders.push(`${name}: appendToScanHistory called with no date argument`);
      } else if (!/^localToday\s*\(\s*\)$/.test(stamped) && !localDayVars.has(stamped)) {
        offenders.push(`${name}: stamps \`${stamped}\`, which is not localToday()`);
      }
    }
  }
  assert.deepEqual(offenders, [], `scan-history writers disagreeing about what day it is:\n  ${offenders.join('\n  ')}`);
});

test('two dates for one posting is all detect-reposts needs to call it a repost', () => {
  // Why the census above is load-bearing. These two rows are ONE posting seen
  // once, in one evening, by two scanners: the curated portals.yml Workday
  // entry and the same tenant reached through the reverse-ATS dataset — the
  // differing-path-case case normalizeUrlForDedup's own docstring describes.
  // Distinct URLs + distinct dates + span 1 is exactly a repost cluster.
  const tsv = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Senior-Backend-Engineer_R123\t2026-08-22\tworkday\tSenior Backend Engineer\tAcme\tadded\tRemote',
    'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/senior-backend-engineer_R123\t2026-08-23\tworkday\tSenior Backend Engineer\tAcme\tadded\tRemote',
  ].join('\n');

  const clusters = detectReposts(parseScanHistory(tsv), 90, 1, null);
  assert.equal(clusters.length, 1, 'the shape mixed stamping produces is a repost cluster');
  assert.equal(clusters[0].daysSpan, 1);

  // Same two rows on ONE date — what the four scanners now produce — are not a
  // cluster. This is the assertion that makes the census mean something.
  const sameDay = tsv.replaceAll('2026-08-23', '2026-08-22');
  assert.deepEqual(detectReposts(parseScanHistory(sameDay), 90, 1, null), [], 'one evening, one date, no repost');
});
