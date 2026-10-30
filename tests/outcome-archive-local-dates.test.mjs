// tests/outcome-archive-local-dates.test.mjs — the outcome and archival path
// dates records by the user's calendar, not by UTC's.
//
// lib/local-today.mjs exists because "what day is it" has a wrong answer:
// `new Date().toISOString().slice(0, 10)` is the UTC day, so west of Greenwich
// an evening run answers with TOMORROW. #2765 fixed followup-seed, #2932
// set-status, #3070 the gates, and outcome.mjs's today() has since been
// converted too. archive-posting.mjs and application-answers.mjs were in none of
// those sweeps and still read the UTC day; this file fixes those two.
//
// outcome.mjs is covered here as a GUARD rather than a fix. It is the script that
// shows why the rule matters: it writes its journal with today() and, in the same
// invocation, spawns set-status.mjs, which stamps data/status-log.tsv with
// localToday(). If today() ever went back to UTC, one event would again produce
// two records a day apart -- so the agreement between those two files is worth an
// assertion even though both sides are correct today.
//
// ── How these assertions avoid the trap that hid the bug ────────────────────
//
// The window where the UTC day and the local day disagree covers only part of
// the UTC day, so a test that reads the wall clock passes for most of the day
// whether the fix is present or not. tests/local-today-gates.test.mjs solves
// that by pinning a frozen instant into a `node -e` child, which works when the
// thing under test is an EXPORT. Two of these three are only reachable through
// their CLI, and freezing a CLI's clock needs either a --import preload (Node
// 18.19+, above the `>=18` floor this was written against) or an argv[1]-rewriting launcher, which
// tests/main-guard-convention.test.mjs gates behind a named exemption.
//
// So: run the same command in TWO timezones 25 hours apart. Pacific/Kiritimati
// is UTC+14 and Pacific/Midway is UTC-11, and two local times 25 hours apart
// cannot share a calendar date -- at any instant, on any day of the year. A
// UTC-derived date is identical in both runs; a local one cannot be. The
// assertion therefore discriminates at every hour of the day, with no frozen
// clock and no wall-clock literal to go stale.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { formatApplicationAnswersSection } from '../application-answers.mjs';

console.log('\noutcome + archival path — dates follow the local calendar');

// 25 hours apart, so never the same calendar day.
const EAST = 'Pacific/Kiritimati';   // UTC+14
const WEST = 'Pacific/Midway';       // UTC-11

/**
 * The calendar day in `tz`, computed independently of the code under test.
 *
 * Assembled from formatToParts() rather than from a formatted string. `en-CA`
 * renders ISO order on the ICU builds this suite has run on, but that is a
 * locale-data detail, not a guarantee — a build that renders MM/DD/YYYY would
 * make every comparison below fail while the code under test was correct, which
 * is the worst way for a test to be wrong.
 *
 * @param {string} tz - IANA zone.
 * @param {Date} [at] - Instant to read; defaults to now.
 * @returns {string} YYYY-MM-DD in `tz`.
 */
function dayIn(tz, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Run `fn`, and report which local days in `tz` the call spanned.
 *
 * A child spawned just before local midnight finishes after it, so a single
 * dayIn() read taken afterwards can name a different day than the one the child
 * saw. Both ends are captured and either is accepted — the same hazard
 * runAcrossUtcDay() exists for in tests/helpers.mjs, for a different midnight.
 *
 * Keeping BOTH (rather than widening to "any day") means a genuinely wrong date
 * still fails: the window is one midnight, not an open set.
 *
 * @template T
 * @param {string} tz
 * @param {() => T} fn
 * @returns {{value: T, days: string[]}}
 */
function spanningLocalDays(tz, fn) {
  const before = dayIn(tz);
  const value = fn();
  const after = dayIn(tz);
  return { value, days: before === after ? [before] : [before, after] };
}

const utcDay = new Date().toISOString().slice(0, 10);

// The premise the whole file rests on, asserted rather than assumed: if these
// two zones ever agreed, every assertion below would pass vacuously.
if (dayIn(EAST) !== dayIn(WEST)) {
  pass(`${EAST} and ${WEST} are on different calendar days (${dayIn(EAST)} vs ${dayIn(WEST)})`);
} else {
  fail(`${EAST} and ${WEST} report the same day — the discriminator is broken, not the code`);
}

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-07-01 | Acme Corp | Senior Backend Engineer | 4.5/5 | Interview | local:output/acme.pdf | local:reports/1-acme.md | Screen passed |',
  '',
].join('\n');

const cleanup = [];

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'outcome-local-dates-'));
  cleanup.push(dir);
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  writeFileSync(join(dir, 'cv.md'), '# Candidate CV\n\nSenior Engineer.\n');
  return dir;
}

/**
 * Record a hire in `tz`.
 *
 * @returns {{journalDate: string|null, ledgerDate: string|null, days: string[]}}
 *   `days` is the local day or days the run spanned — see spanningLocalDays().
 */
function recordHire(tz) {
  const dir = makeWorkspace();
  const before = dayIn(tz);
  execFileSync(NODE, [join(ROOT, 'outcome.mjs'), '1', 'hired', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    env: {
      ...process.env,
      TZ: tz,
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    },
  });

  const outcomesDir = join(dir, 'data', 'outcomes');
  const entryDir = readdirSync(outcomesDir)[0];
  const journal = readFileSync(join(outcomesDir, entryDir, 'outcome.md'), 'utf8');
  const journalDate = (journal.match(/^## Entry: (\d{4}-\d{2}-\d{2})/m) || [])[1] ?? null;

  const ledgerPath = join(dir, 'data', 'status-log.tsv');
  const ledgerDate = existsSync(ledgerPath)
    ? (readFileSync(ledgerPath, 'utf8').trim().split('\n').pop().split('\t')[1] ?? null)
    : null;

  const after = dayIn(tz);
  return { journalDate, ledgerDate, days: before === after ? [before] : [before, after] };
}

// ── outcome.mjs: one event, one date ────────────────────────────────────────
{
  const east = recordHire(EAST);
  const west = recordHire(WEST);

  // The heart of it: the journal and the ledger are written by the same
  // invocation, so they cannot disagree about when the user was hired.
  for (const [tz, r] of [[EAST, east], [WEST, west]]) {
    if (r.journalDate && r.ledgerDate && r.journalDate === r.ledgerDate) {
      pass(`${tz}: the journal and status-log agree on the hire date (${r.journalDate})`);
    } else {
      fail(`${tz}: one invocation wrote two dates — journal ${r.journalDate}, `
        + `status-log ${r.ledgerDate}`);
    }
  }

  // …and each is the day the user was actually living through. Compared against
  // the day(s) the run SPANNED, not against a single read taken afterwards: a
  // child spawned just before local midnight finishes after it.
  for (const [tz, r] of [[EAST, east], [WEST, west]]) {
    if (r.journalDate && r.days.includes(r.journalDate)) {
      pass(`${tz}: the journal entry is dated ${r.journalDate}, the local day`);
    } else {
      fail(`${tz}: journal dated ${r.journalDate}, but the run spanned local day(s) ${r.days.join(' / ')}`);
    }
  }

  // The discriminator. A UTC-derived date is the same string in both zones.
  if (east.journalDate !== west.journalDate) {
    pass('the journal date moves with the timezone, so it is not the UTC day');
  } else {
    fail(`both zones wrote ${east.journalDate} — that is the UTC day (${utcDay}), not a local one`);
  }
}

// ── archive-posting.mjs: the capture filename ───────────────────────────────
//
// Asserted on the REAL filename, not on the expression that builds it.
// `--dry-run` is documented as "preview filename without saving": it prints the
// `local:jds/...` reference and returns before any browser or network work, so
// the actual name is reachable without archiving anything. A source grep would
// pass on a file that no longer produces what it appears to produce — the same
// reason the ATS-coverage panel is tested through its route rather than by
// reading the script.
{
  const dateFromModule = (tz) => execFileSync(NODE, [
    '--input-type=module', '-e',
    `import { localToday } from ${JSON.stringify(new URL('../lib/local-today.mjs', import.meta.url).href)};`
    + 'process.stdout.write(localToday());',
  ], { encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 30_000 }).trim();

  const east = spanningLocalDays(EAST, () => dateFromModule(EAST));
  const west = spanningLocalDays(WEST, () => dateFromModule(WEST));
  if (east.days.includes(east.value) && west.days.includes(west.value) && east.value !== west.value) {
    pass('archive-posting/outcome share localToday(), which tracks the local day in both zones');
  } else {
    fail(`localToday() gave ${east.value} in ${EAST} and ${west.value} in ${WEST}; `
      + `the runs spanned ${east.days.join(' / ')} and ${west.days.join(' / ')}`);
  }

  // The capture name itself, from a real run in each zone.
  const captureName = (tz) => {
    const out = execFileSync(
      NODE,
      [join(ROOT, 'archive-posting.mjs'), '--dry-run', 'https://boards.greenhouse.io/openai/jobs/123'],
      { encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 30_000 },
    );
    return (out.match(/local:jds\/(\d{4}-\d{2}-\d{2})_/) || [])[1] ?? null;
  };

  const eastName = spanningLocalDays(EAST, () => captureName(EAST));
  const westName = spanningLocalDays(WEST, () => captureName(WEST));

  for (const [tz, r] of [[EAST, eastName], [WEST, westName]]) {
    if (r.value && r.days.includes(r.value)) {
      pass(`${tz}: the capture is named for ${r.value}, the local day`);
    } else {
      fail(`${tz}: capture named for ${r.value}, but the run spanned local day(s) ${r.days.join(' / ')}`);
    }
  }

  // The hour-independent half: a UTC-derived name is the same string in both
  // zones, whatever time it is.
  if (eastName.value && westName.value && eastName.value !== westName.value) {
    pass('the capture filename moves with the timezone, so it is not the UTC day');
  } else {
    fail(`both zones named the capture ${eastName.value} — the UTC day (${utcDay}), not a local one`);
  }
}

// ── application-answers.mjs: the default date ──────────────────────────────
//
// formatApplicationAnswersSection is exported, so this one is a direct call in a
// child pinned to each zone -- no source reading needed.
{
  const renderedDate = (tz) => {
    const out = execFileSync(NODE, [
      '--input-type=module', '-e',
      `import { formatApplicationAnswersSection } from ${JSON.stringify(new URL('../application-answers.mjs', import.meta.url).href)};`
      + 'process.stdout.write(formatApplicationAnswersSection({ state: "filled" }));',
    ], { encoding: 'utf8', env: { ...process.env, TZ: tz }, timeout: 30_000 });
    return (out.match(/\d{4}-\d{2}-\d{2}/) || [])[0] ?? null;
  };

  const east = spanningLocalDays(EAST, () => renderedDate(EAST));
  const west = spanningLocalDays(WEST, () => renderedDate(WEST));

  for (const [tz, r] of [[EAST, east], [WEST, west]]) {
    if (r.value && r.days.includes(r.value)) {
      pass(`${tz}: the default answer date is ${r.value}, the local day`);
    } else {
      fail(`${tz}: default answer date was ${r.value}, but the run spanned local day(s) ${r.days.join(' / ')}`);
    }
  }
  if (east.value !== west.value) pass('the default answer date moves with the timezone');
  else fail(`both zones rendered ${east.value} — the UTC day (${utcDay}), not a local one`);

  // Guard: an explicit date is passed through untouched. The fix changes only
  // what "no date given" resolves to.
  const explicit = formatApplicationAnswersSection({ state: 'filled', date: '2026-01-02' });
  if (explicit.includes('2026-01-02')) pass('an explicit date is still passed through unchanged');
  else fail(`explicit date was rewritten: ${explicit.slice(0, 200)}`);
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
