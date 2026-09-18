// @ts-check
/**
 * calibrate.mjs — Does your evaluation scoring predict your real outcomes? (#3315, part of #1724)
 *
 * Reads the tracker and the outcome journals under data/outcomes/ (written by
 * outcome.mjs) and answers the question the learning loop exists for: do your
 * higher-scored applications actually convert better FOR YOU?
 *
 * Strictly advisory. This script never edits scoring rules, thresholds,
 * modes/_shared.md, or any user file — it reads, aggregates, and reports.
 * The scoring system stays global; what is personal is the evidence about
 * how it performs on your search.
 *
 * Usage:
 *   node calibrate.mjs                  (human-readable report)
 *   node calibrate.mjs --json           (full JSON to stdout)
 *   node calibrate.mjs --min-band-n 5   (per-band sample floor, default 5)
 *   node calibrate.mjs --self-test
 *
 * Honesty rules, in order of importance:
 *   - An application still in flight (Applied/Responded with no recorded
 *     outcome) is NOT a data point. Counting it as a failure would punish
 *     recent applications; counting it as a success would flatter everything.
 *     It is excluded from every rate and reported separately as in-flight.
 *   - No percentage is printed on a band below the sample floor. "2 of 3
 *     got interviews" is an anecdote wearing a rate's clothes.
 *   - Evidence precedence: the outcome journal (data/outcomes/) wins, then the
 *     transition ledger (data/status-log.tsv), then the tracker status. The
 *     journal records what actually happened (outcome.mjs); the ledger records
 *     the stages a row passed through (set-status.mjs), so a declined offer now
 *     sitting in Discarded still counts as an offer; the current status is only
 *     a workflow snapshot and loses that history.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parseTrackerRow, resolveColumns, isSeparatorRow, isHeaderRow } from './tracker-parse.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { canonicalOutcome } from './lib/outcome-types.mjs';
import { outcomeDirsFor } from './lib/outcome-dir.mjs';

// The USER's data root, not this file's directory. It was __dirname under the
// name CAREER_OPS, so resolveTrackerPath() looked inside the checkout and a user
// with CAREER_OPS_ROOT (or a .career-ops-data marker) got "No tracker found ...
// nothing to calibrate yet" — which reads as "you have no outcome data",
// exactly the thing this advisory is meant to answer.
const DATA_ROOT = getCareerOpsRoot();

// --- Outcome semantics ---------------------------------------------------
//
// Two tiers, both cumulative: reaching an interview is success tier 1
// whatever happened afterwards (an offer you declined still proves the
// scoring picked a matchable role), and an offer is tier 2. `rejected` and
// `no_response` are terminal negatives. `interview_only` means the process
// ended after interviews with no offer — it still reached tier 1.
// Keyed by CANONICAL type only. outcome.mjs accepts fourteen spellings and
// writes whichever one was typed straight into the journal, so every read goes
// through canonicalOutcome() first — a private list of the seven canonical
// names silently ignored the other seven (see lib/outcome-types.mjs).
export const JOURNAL_OUTCOMES = {
  hired: { reachedInterview: true, reachedOffer: true, terminal: true },
  offer_received: { reachedInterview: true, reachedOffer: true, terminal: true },
  offer_declined: { reachedInterview: true, reachedOffer: true, terminal: true },
  interview_progress: { reachedInterview: true, reachedOffer: false, terminal: false },
  interview_only: { reachedInterview: true, reachedOffer: false, terminal: true },
  rejected: { reachedInterview: false, reachedOffer: false, terminal: true },
  no_response: { reachedInterview: false, reachedOffer: false, terminal: true },
};

// Tracker statuses that resolve an application even without a journal.
// `interview`/`offer`/`hired` prove tier reach; `rejected` is terminal
// negative. Everything else (applied, responded, evaluated…) is in-flight
// or pre-application and carries no outcome evidence.
const TRACKER_TERMINAL = {
  hired: { reachedInterview: true, reachedOffer: true },
  offer: { reachedInterview: true, reachedOffer: true },
  interview: { reachedInterview: true, reachedOffer: false },
  rejected: { reachedInterview: false, reachedOffer: false },
};

const BANDS = [
  { key: '<3.5', min: -Infinity, max: 3.5 },
  { key: '3.5-3.9', min: 3.5, max: 4.0 },
  { key: '4.0-4.4', min: 4.0, max: 4.5 },
  { key: '>=4.5', min: 4.5, max: Infinity },
];

/**
 * Parse one outcome.md journal into its latest entry + all verbatim feedback.
 *
 * The journal is append-only (outcome.mjs), so the LAST `## Entry:` block is
 * the current truth — an application that went interview_progress and later
 * rejected must read as rejected, not as its happiest historical moment.
 *
 * @param {string} text
 * @returns {{ latestType: string|null, feedback: string[] }}
 */
export function parseOutcomeJournal(text) {
  const entries = String(text ?? '').split(/^## Entry: /m).slice(1);
  let latestType = null;
  const feedback = [];
  for (const entry of entries) {
    const typeMatch = entry.match(/^- \*\*Outcome Type\*\*: *(\S+)/m);
    // Assigned UNCONDITIONALLY when the field is present, including when it
    // resolves to null. The last entry is the truth, so a final entry this
    // vocabulary cannot read must not leave the previous one standing —
    // `interview_progress` then `withdrawn_by_employer` is not an application
    // still progressing through interviews. Clearing it falls through to the
    // tracker status, which is the honest answer for an outcome we cannot read;
    // keeping the earlier one is the happiest-historical-moment behaviour this
    // function's contract forbids.
    if (typeMatch) latestType = canonicalOutcome(typeMatch[1]);
    // Feedback is a blockquote under "Verbatim Feedback"; "None recorded" is
    // the explicit empty marker outcome.mjs writes, not user content.
    const fbMatch = entry.match(/- \*\*Verbatim Feedback\*\*:\n((?:> .*\n?)+)/);
    if (fbMatch) {
      const fb = fbMatch[1].split('\n').map((l) => l.replace(/^> ?/, '').trim()).filter(Boolean).join(' ');
      if (fb && fb !== 'None recorded') feedback.push(fb);
    }
  }
  return { latestType, feedback };
}

/**
 * The core aggregation, pure so the self-test can exercise every branch
 * without touching a filesystem.
 *
 * @param {Array<{num:number, company:string, score:number|null, status:string}>} rows
 * @param {Map<number, {latestType:string|null, feedback:string[]}>} journals
 * @param {{minBandN?: number, reached?: Map<number, {reachedInterview:boolean, reachedOffer:boolean}>}} [opts]
 */
export function computeCalibration(rows, journals, opts = {}) {
  const minBandN = opts.minBandN ?? 5;
  const reached = opts.reached ?? new Map();

  const resolved = [];
  const inFlight = [];
  const unscored = [];
  const allFeedback = [];

  for (const row of rows) {
    const journal = journals.get(row.num);
    if (journal?.feedback?.length) {
      for (const fb of journal.feedback) allFeedback.push({ num: row.num, company: row.company, feedback: fb });
    }
    let verdict = null;
    const led = reached.get(row.num);
    if (journal?.latestType) {
      verdict = { source: 'journal', type: journal.latestType, ...JOURNAL_OUTCOMES[journal.latestType] };
    } else if (led && (led.reachedInterview || led.reachedOffer)) {
      // Ledger evidence: the row passed through interview/offer per its
      // transition history, so it resolves at that tier even though its current
      // status is now terminal (a declined offer reads as Discarded, an
      // interview that ended in rejection reads as Rejected). Offer implies
      // interview, so reachedInterview is always true on this branch.
      verdict = { source: 'ledger', type: led.reachedOffer ? 'offer' : 'interview', reachedInterview: true, reachedOffer: !!led.reachedOffer };
    } else {
      const s = String(row.status || '').replace(/\*\*/g, '').trim().toLowerCase().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '');
      if (TRACKER_TERMINAL[s]) verdict = { source: 'tracker', type: s, ...TRACKER_TERMINAL[s] };
      else if (['applied', 'responded'].includes(s)) { inFlight.push(row.num); continue; }
      else continue; // evaluated / discarded / skip with no stage history — outside calibration's population
    }
    if (!Number.isFinite(row.score) || row.score <= 0) { unscored.push(row.num); continue; }
    resolved.push({ num: row.num, score: row.score, ...verdict });
  }

  const bands = BANDS.map((b) => {
    const members = resolved.filter((r) => r.score >= b.min && r.score < b.max);
    const interviews = members.filter((r) => r.reachedInterview).length;
    const offers = members.filter((r) => r.reachedOffer).length;
    const enough = members.length >= minBandN;
    return {
      band: b.key,
      n: members.length,
      interviews,
      offers,
      // Below the floor the counts are still shown, the RATES are withheld:
      // the reader can see the raw anecdote without being handed a fake rate.
      interviewRate: enough ? Math.round((interviews / members.length) * 100) : null,
      offerRate: enough ? Math.round((offers / members.length) * 100) : null,
    };
  });

  // Verdict: compare the highest and lowest bands that clear the floor.
  // One qualifying band (or none) is not a comparison — say so instead.
  const rated = bands.filter((b) => b.interviewRate !== null);
  let verdict;
  if (rated.length < 2) {
    verdict = {
      kind: 'insufficient',
      text: `Not enough resolved outcomes to compare score bands yet (${resolved.length} resolved, floor ${minBandN} per band). Keep recording with /outcome and rerun.`,
    };
  } else {
    const low = rated[0];
    const high = rated[rated.length - 1];
    const gap = high.interviewRate - low.interviewRate;
    if (gap >= 10) {
      verdict = { kind: 'separating', text: `The scoring is separating for you: your ${high.band} applications reached interviews at ${high.interviewRate}% vs ${low.interviewRate}% for ${low.band}. Trusting the score is paying off.` };
    } else if (gap <= -10) {
      verdict = { kind: 'inverted', text: `Inverted signal: your ${low.band} applications are converting BETTER (${low.interviewRate}%) than your ${high.band} ones (${high.interviewRate}%). Worth reading what the high-scored rejections had in common before trusting the next 4.5.` };
    } else {
      verdict = { kind: 'flat', text: `No meaningful separation yet: ${high.band} converts at ${high.interviewRate}% vs ${low.interviewRate}% for ${low.band}. With more resolved outcomes this usually sharpens one way or the other.` };
    }
  }

  return {
    resolved: resolved.length,
    inFlight: inFlight.length,
    unscored: unscored.length,
    bands,
    verdict,
    feedback: allFeedback.slice(-10),
  };
}

// --- Filesystem assembly --------------------------------------------------

export function loadTrackerRows(appsFile) {
  const lines = readFileSync(appsFile, 'utf-8').split(/\r?\n/);
  // resolveColumns() takes the LINE ARRAY and locates the header itself.
  // Passing it a single header string made detectColumns() iterate that
  // string character by character, find no header, and fall back to
  // LEGACY_COLMAP — the 9-column order with no Via column. On a tracker that
  // HAS Via (#1596), where the column sits between Company and Role, every
  // field from `role` onward then reads one column to the left: `status`
  // reads the score cell ("4.5/5"), no status matches, and every row silently
  // drops out of the population. The report renders 0 resolved / 0 in-flight
  // and a false "insufficient data" verdict on a tracker full of outcomes.
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|') || isHeaderRow(line) || isSeparatorRow(line)) continue;
    const row = parseTrackerRow(line, colmap);
    if (!row || !Number.isFinite(row.num)) continue;
    // parseFloat reads "4.4" and the "4.4/5" cell form identically (it stops
    // at the slash); a blank or textual score cell becomes null, not 0 — a
    // zero would silently land the row in the lowest band.
    const score = parseFloat(String(row.score ?? ''));
    rows.push({ num: row.num, company: row.company || '', score: Number.isFinite(score) ? score : null, status: row.status || '' });
  }
  return rows;
}

function loadJournals(workspaceRoot) {
  const journals = new Map();
  const dir = join(workspaceRoot, 'data', 'outcomes');
  if (!existsSync(dir)) return journals;

  // Collect the tracker numbers present, then resolve each ONE directory.
  // Directory shape is {num}_{company_slug}_{role_slug} (outcome.mjs), and a
  // row can have more than one: before the slug was pinned, editing the
  // tracker's Role cell between two recordings started a second directory and
  // split the append-only journal in half. Iterating entries and calling
  // journals.set() per directory meant whichever sorted last won — so which
  // half of the history calibration saw came down to alphabetical order.
  // outcomeDirsFor() puts the most recently written journal first.
  const nums = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const numMatch = entry.name.match(/^(\d+)_/);
    if (numMatch) nums.add(parseInt(numMatch[1], 10));
  }
  for (const num of nums) {
    const dirs = outcomeDirsFor(dir, num);
    const logPath = dirs.length ? join(dir, dirs[0], 'outcome.md') : null;
    if (!logPath || !existsSync(logPath)) continue;
    const journal = parseOutcomeJournal(readFileSync(logPath, 'utf-8'));
    // A split is reported rather than silently resolved: repairing it means
    // moving a user's recorded artifacts, which a read-only report must not do.
    if (dirs.length > 1) journal.splitAcross = dirs;
    journals.set(num, journal);
  }
  return journals;
}

/**
 * Per-row stage-reached evidence from the transition ledger data/status-log.tsv
 * ({num}\t{date}\t{from}\t{to}\t{source}\t{note}). A row reached interview if any
 * transition entered OR left Interview/Offer/Hired; reached offer if it entered
 * OR left Offer/Hired. Offer implies interview. Missing file → empty Map (the
 * calibration falls back to journals + current status, exactly as before).
 * @returns {Map<number, {reachedInterview:boolean, reachedOffer:boolean}>}
 */
export function loadLedgerReached(workspaceRoot) {
  const reached = new Map();
  const logPath = join(workspaceRoot, 'data', 'status-log.tsv');
  if (!existsSync(logPath)) return reached;
  const INTERVIEW_PLUS = new Set(['interview', 'offer', 'hired']);
  const OFFER_PLUS = new Set(['offer', 'hired']);
  for (const line of readFileSync(logPath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    const rawNum = String(c[0] || '').trim();
    const date = String(c[1] || '').trim();
    const rawFrom = String(c[2] || '').trim();
    const rawTo = String(c[3] || '').trim();
    if (!/^\d+$/.test(rawNum) || !date || !rawFrom || !rawTo) continue;
    const num = Number(rawNum);
    const from = rawFrom.toLowerCase();
    const to = rawTo.toLowerCase();
    const cur = reached.get(num) || { reachedInterview: false, reachedOffer: false };
    if (INTERVIEW_PLUS.has(from) || INTERVIEW_PLUS.has(to)) cur.reachedInterview = true;
    if (OFFER_PLUS.has(from) || OFFER_PLUS.has(to)) { cur.reachedOffer = true; cur.reachedInterview = true; }
    reached.set(num, cur);
  }
  return reached;
}

function renderHuman(result) {
  const out = [];
  out.push('📐 Calibration — your scores vs your real outcomes');
  out.push('');
  out.push(`Resolved outcomes: ${result.resolved} · in flight (not counted): ${result.inFlight} · unscored: ${result.unscored}`);
  out.push('');
  out.push('| Score band | n | Interviews | Offers | Interview rate | Offer rate |');
  out.push('|---|---|---|---|---|---|');
  for (const b of result.bands) {
    const ir = b.interviewRate === null ? '(n too small)' : `${b.interviewRate}%`;
    const or_ = b.offerRate === null ? '' : `${b.offerRate}%`;
    out.push(`| ${b.band} | ${b.n} | ${b.interviews} | ${b.offers} | ${ir} | ${or_} |`);
  }
  out.push('');
  out.push(`Verdict: ${result.verdict.text}`);
  if (result.feedback.length) {
    out.push('');
    out.push('Signals from recorded feedback (latest 10):');
    for (const f of result.feedback) out.push(`- #${f.num} ${f.company}: "${f.feedback}"`);
  }
  out.push('');
  out.push('This report is advisory. It never changes scoring rules — that conversation belongs to you.');
  return out.join('\n');
}

// --- Self-test ------------------------------------------------------------

function selfTest() {
  const failures = [];
  const t = (name, cond) => { if (!cond) failures.push(name); };

  // Journal parsing: last entry wins, feedback collected, "None recorded" skipped.
  const journal = parseOutcomeJournal([
    '# Application Outcome Log — Acme — Dev (#7)', '',
    '## Entry: 2026-08-01',
    '- **Outcome Type**: interview_progress',
    '- **Canonical State**: Interview',
    '- **Stage Reached**: phone screen',
    '- **Verbatim Feedback**:',
    '> None recorded',
    '- **Notes**: n',
    '',
    '## Entry: 2026-08-20',
    '- **Outcome Type**: rejected',
    '- **Canonical State**: Rejected',
    '- **Stage Reached**: onsite',
    '- **Verbatim Feedback**:',
    '> Strong system design, gaps in Go depth',
    '- **Notes**: n',
  ].join('\n'));
  t('journal: last entry wins', journal.latestType === 'rejected');
  t('journal: feedback collected', journal.feedback.length === 1 && journal.feedback[0].includes('Go depth'));

  const mk = (num, score, status) => ({ num, company: `C${num}`, score, status });
  const J = (type) => ({ latestType: type, feedback: [] });

  // Separating: high band converts, low band does not. Floor 2 to keep fixtures small.
  const sep = computeCalibration(
    [mk(1, 4.6, 'Applied'), mk(2, 4.7, 'Applied'), mk(3, 3.2, 'Applied'), mk(4, 3.1, 'Applied'), mk(5, 4.0, 'Responded')],
    new Map([[1, J('hired')], [2, J('interview_only')], [3, J('no_response')], [4, J('rejected')]]),
    { minBandN: 2 },
  );
  t('separating verdict', sep.verdict.kind === 'separating');
  t('in-flight excluded from resolved', sep.resolved === 4 && sep.inFlight === 1);
  t('offer counted only on offer tier', sep.bands.find((b) => b.band === '>=4.5').offers === 1);

  // Inverted: low band converts better.
  const inv = computeCalibration(
    [mk(1, 4.6, 'x'), mk(2, 4.7, 'x'), mk(3, 3.2, 'x'), mk(4, 3.1, 'x')].map((r) => ({ ...r, status: 'Applied' })),
    new Map([[1, J('no_response')], [2, J('rejected')], [3, J('hired')], [4, J('interview_only')]]),
    { minBandN: 2 },
  );
  t('inverted verdict', inv.verdict.kind === 'inverted');

  // Floor honesty: 1 resolved outcome → no rates, insufficient verdict.
  const thin = computeCalibration([mk(1, 4.6, 'Applied')], new Map([[1, J('hired')]]), { minBandN: 5 });
  t('thin data withholds rates', thin.bands.every((b) => b.interviewRate === null));
  t('thin data verdict is insufficient', thin.verdict.kind === 'insufficient');

  // Tracker fallback resolves terminal statuses, in-flight stays out, and a
  // journal outranks a contradicting tracker status.
  const fb = computeCalibration(
    [mk(1, 4.2, 'Interview'), mk(2, 4.1, 'Applied'), mk(3, 4.3, 'Applied')],
    new Map([[3, J('rejected')]]),
    { minBandN: 2 },
  );
  t('tracker terminal resolves', fb.resolved === 2);
  t('journal outranks tracker', fb.bands.find((b) => b.band === '4.0-4.4').interviews === 1);

  // Never-applied rows (Evaluated / Discarded) are outside the population.
  const pop = computeCalibration([mk(1, 4.2, 'Evaluated'), mk(2, 2.1, 'Discarded')], new Map(), { minBandN: 2 });
  t('never-applied excluded', pop.resolved === 0 && pop.inFlight === 0);

  // Ledger evidence resolves stage-reached even when the current status is
  // terminal: a declined offer (now Discarded) counts as reachedOffer, an
  // interview that ended in Rejected counts as reachedInterview, and a Discarded
  // row with no ledger history stays outside the population.
  const led = computeCalibration(
    [mk(1, 4.6, 'Discarded'), mk(2, 4.5, 'Rejected'), mk(3, 4.2, 'Discarded')],
    new Map(),
    { minBandN: 2, reached: new Map([[1, { reachedInterview: true, reachedOffer: true }], [2, { reachedInterview: true, reachedOffer: false }]]) },
  );
  const ledHigh = led.bands.find((b) => b.band === '>=4.5');
  t('ledger resolves declined offer as reachedOffer', ledHigh.offers === 1 && ledHigh.interviews === 2 && led.resolved === 2);
  t('ledger leaves history-less Discarded excluded', led.bands.find((b) => b.band === '4.0-4.4').n === 0);
  // A journal still outranks the ledger (explicit /outcome record wins).
  const ledVsJournal = computeCalibration(
    [mk(1, 4.6, 'Discarded')], new Map([[1, J('rejected')]]),
    { minBandN: 1, reached: new Map([[1, { reachedInterview: true, reachedOffer: true }]]) },
  );
  t('journal outranks ledger', ledVsJournal.bands.find((b) => b.band === '>=4.5').offers === 0);

  if (failures.length) {
    console.error(`❌ calibrate self-test: ${failures.length} failure(s):\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('✅ calibrate.mjs self-test: all checks passed');
  process.exit(0);
}

// --- CLI ------------------------------------------------------------------

// Entry guard (repo convention, cf. outcome.mjs / linkedin-join.mjs): without
// it, importing this module to unit-test its exports would run the whole CLI
// against the real tracker inside the test process.
import { isMainModule } from './lib/is-main-module.mjs';

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();

  const minFlagIdx = argv.indexOf('--min-band-n');
  const minBandN = minFlagIdx !== -1 ? parseInt(argv[minFlagIdx + 1], 10) : 5;
  if (!Number.isInteger(minBandN) || minBandN < 1) {
    console.error('--min-band-n must be a positive integer');
    process.exit(2);
  }
  const appsFile = resolveTrackerPath(DATA_ROOT);
  if (!existsSync(appsFile)) {
    console.error(`No tracker found at ${appsFile} — nothing to calibrate yet.`);
    process.exit(1);
  }
  const workspaceRoot = resolveWorkspaceRoot(appsFile);
  const rows = loadTrackerRows(appsFile);
  const journals = loadJournals(workspaceRoot);
  const reached = loadLedgerReached(workspaceRoot);
  const result = computeCalibration(rows, journals, { minBandN, reached });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
}
