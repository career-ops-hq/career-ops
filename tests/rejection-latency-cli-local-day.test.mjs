// tests/rejection-latency-cli-local-day.test.mjs — the CLI evaluates on the
// LOCAL calendar day, the default computeRejectionLatency() documents.
//
// computeRejectionLatency() defaults `today` to parseDate(localToday()) and
// says why: daysBetween() reduces both operands to their UTC date, so a bare
// clock read west of Greenwich counts one extra day all evening, and a company
// crosses the courtesy threshold a day early and gets a ready-to-copy
// blacklist row stamped with tomorrow's date. But the default only applies
// when no Date is passed, and the CLI passed `new Date()`. So the CLI, the one
// entry point a user runs, used the UTC day; east of Greenwich it missed a
// flag for the same reason.
//
// The existing check calls the export, which is why it never saw this. This
// one runs the CLI, in two zones 25 hours apart (the technique
// outcome-archive-local-dates.test.mjs documents): no instant puts them on the
// same calendar day, so a UTC-derived day fails one of the two runs at any
// hour, with no frozen clock.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const EAST = 'Pacific/Kiritimati'; // UTC+14
const WEST = 'Pacific/Midway';     // UTC-11
const ROUND = '2026-01-01';

/** The calendar day in `tz`, independent of the code under test. */
function dayIn(tz, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const daysSince = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const dir = mkdtempSync(join(tmpdir(), 'rejection-latency-local-day-'));
try {
  const interviews = join(dir, 'active-interviews.md');
  const tracker = join(dir, 'applications.md');
  writeFileSync(interviews, [
    '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    `| Acme Corp | Backend Engineer | Final | ${ROUND} | Panel | Done | final round |`,
    '',
  ].join('\n'));
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2025-12-01 | Acme Corp | Backend Engineer | 4.2/5 | Interview | ✅ | — | waiting |',
    '',
  ].join('\n'));

  /** Run the CLI in `tz`; return its JSON and the local day(s) the run spanned. */
  const runIn = (tz) => {
    const before = dayIn(tz);
    const out = execFileSync(NODE, [join(ROOT, 'rejection-latency.mjs'), '--file', interviews, '--tracker', tracker], {
      encoding: 'utf-8', env: { ...process.env, TZ: tz },
    });
    const after = dayIn(tz);
    // A run that straddles local midnight may name either day; a wrong date still fails.
    return { json: JSON.parse(out), days: before === after ? [before] : [before, after] };
  };

  console.log('\nrejection-latency CLI — the day is the local calendar day');

  ok(`premise: ${EAST} and ${WEST} are on different calendar days`, () => {
    // If these ever agreed, every check below would pass vacuously.
    assert.notStrictEqual(dayIn(EAST), dayIn(WEST));
  });

  for (const tz of [EAST, WEST]) {
    ok(`in ${tz} the CLI evaluates on the local day, and counts days from it`, () => {
      const { json, days } = runIn(tz);
      assert.ok(days.includes(json.metadata.today),
        `metadata.today is ${json.metadata.today}, the local day is ${days.join(' or ')}`);
      const acme = json.flags.find((f) => f.company === 'Acme Corp');
      assert.ok(acme, 'premise: a round months ago is flagged');
      assert.strictEqual(acme.daysSinceLastInterview, daysSince(ROUND, json.metadata.today));
      assert.ok(acme.blacklistSuggestion.includes(`| ${json.metadata.today} |`), 'the suggestion is stamped with that day');
    });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
