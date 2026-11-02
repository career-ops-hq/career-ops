// tests/dedup-tracker-promotion-ledger.test.mjs — a promoted status is written
// without its legacy decoration, so the ledger and the hooks can read it.
//
// When dedup removes a row with a more advanced status, it promotes that status
// onto the kept row. statusRank() strips markdown bold and a trailing date
// before ranking, so a legacy `Applied 2026-01-02` cell could win the
// promotion, but the cell was then copied verbatim:
//
//   - the kept row's Status cell got a date in it (AGENTS.md: no dates in the
//     status field);
//   - resolveCanonicalState() read the promoted value as unknown, so the
//     status-log line said `Evaluated → -`. funnel-velocity replays a `-`
//     destination as a retraction, so the row's real `Evaluated` transition
//     was popped and its timeline came back empty;
//   - the Applied hook (follow-up seeding) never ran for a row that had just
//     become Applied.
//
// The donor's spelling is kept (an alias stays an alias; see
// dedup-tracker-status-aliases.test.mjs). Only the decoration goes.
//
// Drives the REAL dedup-tracker.mjs CLI against a temp tracker via the
// CAREER_OPS_TRACKER hook. The status-log and follow-ups land next to it.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadCanonicalStates } from '../tracker-utils.mjs';
import { parseStatusLog, replayObservations } from '../funnel-velocity.mjs';

const DEDUP = join(ROOT, 'dedup-tracker.mjs');
const STATES = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const PRIOR_LEDGER = '7\t2026-10-01\t-\tEvaluated\tset-status\t\n';

/**
 * Keeper #7 (higher score) and donor #9 share report 40, so they are one
 * report identity and the donor's status is promoted onto #7.
 */
function promote(keeperStatus, donorStatus) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-promotion-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP,
      `| 7 | 2026-10-01 | Acme | Platform Engineer | 4.5/5 | ${keeperStatus} | ❌ | [40](reports/040-acme.md) |  |`,
      `| 9 | 2026-01-02 | Acme | Platform Engineer | 4.0/5 | ${donorStatus} | ❌ | [40](reports/040-acme.md) |  |`,
      ''].join('\n'));
    writeFileSync(join(dir, 'status-log.tsv'), PRIOR_LEDGER);
    const r = spawnSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.strictEqual(r.status, 0, `dedup-tracker exited ${r.status}: ${r.stderr}`);
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
    const ledger = readFileSync(join(dir, 'status-log.tsv'), 'utf-8');
    const followups = existsSync(join(dir, 'follow-ups.md')) ? readFileSync(join(dir, 'follow-ups.md'), 'utf-8') : null;
    return { rows, ledger, followups };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const statusOf = (line) => line.split('|')[6].trim();
const dedupLine = (ledger) => ledger.split('\n').find(l => l.includes('\tdedup-tracker\t'));

console.log('\ndedup-tracker — a promoted status is written without its decoration');

ok('a dated donor cell is promoted as the bare status, and the ledger names it', () => {
  // THE BUG: the cell kept the date and the ledger said `Evaluated → -`.
  const { rows, ledger } = promote('Evaluated', 'Applied 2026-01-02');
  assert.strictEqual(rows.length, 1, 'premise: the two rows are one report identity');
  assert.strictEqual(statusOf(rows[0]), 'Applied', 'no date may reach the Status cell');
  assert.match(dedupLine(ledger) ?? '', /^7\t\d{4}-\d{2}-\d{2}\tEvaluated\tApplied\tdedup-tracker\tfrom #9$/,
    `the ledger must record the promotion, got ${JSON.stringify(dedupLine(ledger))}`);
});

ok('the promotion adds to the row timeline instead of retracting it', () => {
  // What `to: -` cost downstream: funnel-velocity pops the last transition on
  // a `-` destination, so the row's real Evaluated observation disappeared.
  const { ledger } = promote('Evaluated', 'Applied 2026-01-02');
  const { observations } = parseStatusLog(ledger, STATES);
  const timeline = replayObservations(observations).get(7) ?? [];
  assert.deepStrictEqual(timeline.map(o => o.to), ['Evaluated', 'Applied']);
});

ok('the Applied hook runs for a row that became Applied through a dated cell', () => {
  // The post-lock hook resolves the promoted value; unknown, it skipped the
  // follow-up seeding.
  const { followups } = promote('Evaluated', 'Applied 2026-01-02');
  assert.ok(followups && /next #7 \d{4}-\d{2}-\d{2}/.test(followups), `no follow-up was seeded for #7: ${followups}`);
});

ok('bold is stripped the same way', () => {
  const { rows, ledger } = promote('Evaluated', '**Applied**');
  assert.strictEqual(statusOf(rows[0]), 'Applied');
  assert.match(dedupLine(ledger) ?? '', /\tEvaluated\tApplied\tdedup-tracker\t/);
});

ok('an alias keeps its spelling; only the date goes', () => {
  // dedup-tracker-status-aliases.test.mjs pins that a promoted alias is the
  // donor's own spelling. That still holds with a date on it.
  const { rows, ledger } = promote('Evaluated', 'Başvuruldu 2026-01-02');
  assert.strictEqual(statusOf(rows[0]), 'Başvuruldu');
  assert.match(dedupLine(ledger) ?? '', /\tEvaluated\tApplied\tdedup-tracker\t/);
});

ok("a dated keeper cell is logged as its state, not as unknown", () => {
  // The from side of the same line: `Evaluated 2026-10-01` is a known state.
  const { rows, ledger } = promote('Evaluated 2026-10-01', 'Applied');
  assert.strictEqual(statusOf(rows[0]), 'Applied');
  assert.match(dedupLine(ledger) ?? '', /\tEvaluated\tApplied\tdedup-tracker\t/,
    `from must be Evaluated, got ${JSON.stringify(dedupLine(ledger))}`);
});
