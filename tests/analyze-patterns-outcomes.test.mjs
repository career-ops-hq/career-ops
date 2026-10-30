// tests/analyze-patterns-outcomes.test.mjs — outcome classification and the
// conversion denominators in analyze-patterns.mjs.
//
// These two are tested together because they fail together: counting a sent-
// but-unanswered application as a positive outcome AND dividing by a `total`
// that includes never-sent rows both push the reported conversion rate away
// from what the employer actually did. On a small or healthy tracker the wrong
// and right readings look similar; they diverge once a real pile of unanswered
// applications accumulates, which is exactly when someone reads the number to
// decide where to aim next.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nanalyze-patterns — outcome classification & conversion denominators');

const { classifyOutcome, newOutcomeCounts, withOutcomeRates, OUTCOME_BUCKETS, bestDecidedSegment, worstDecidedSegment, scoreThresholdFrom } =
  await import(pathToFileURL(join(ROOT, 'analyze-patterns.mjs')).href);

// --- classifyOutcome ---------------------------------------------------------

const OUTCOMES = [
  ['Applied', 'awaiting', 'sent, no answer yet'],
  ['Responded', 'positive', 'the employer answered'],
  ['Interview', 'positive', 'advanced past screening'],
  ['Offer', 'positive', 'offer in hand'],
  ['Hired', 'positive', 'landed the job'],
  ['Rejected', 'negative', 'the employer said no'],
  ['Discarded', 'discarded', 'withdrawn or the posting died — not an employer decision'],
  ['SKIP', 'self_filtered', 'never sent, by our own choice'],
  ['Evaluated', 'pending', 'scored, not sent'],
];

let ok = true;
for (const [status, expected, why] of OUTCOMES) {
  const got = classifyOutcome(status);
  if (got !== expected) { fail(`classifyOutcome('${status}') → '${got}', expected '${expected}' (${why})`); ok = false; }
}
if (ok) pass('classifyOutcome maps every canonical status to its outcome bucket');

// Spanish aliases run through the same normalization; 'aplicado' must not be a
// positive either, or the bug simply reappears for Spanish-language trackers.
if (classifyOutcome('aplicado') === 'awaiting' && classifyOutcome('enviada') === 'awaiting') {
  pass("Spanish 'applied' aliases resolve to 'awaiting', not 'positive'");
} else {
  fail(`aplicado → '${classifyOutcome('aplicado')}', enviada → '${classifyOutcome('enviada')}'`);
}

// --- every bucket exists on a counter row ------------------------------------
// `entry[outcome]++` on a key the row does not define writes NaN and poisons
// the whole breakdown silently, so the two must be kept in lockstep.
const row = newOutcomeCounts();
const missing = [...new Set(OUTCOMES.map(([s]) => classifyOutcome(s)))].filter((b) => !(b in row));
if (missing.length === 0) pass('newOutcomeCounts() defines every bucket classifyOutcome can return');
else fail(`newOutcomeCounts() is missing buckets: ${missing.join(', ')}`);

if (row.total === 0 && Object.values(row).every((v) => v === 0)) pass('newOutcomeCounts() starts zeroed');
else fail(`newOutcomeCounts() = ${JSON.stringify(row)}`);

// --- withOutcomeRates --------------------------------------------------------
// 25 rows in the segment, of which only 10 were ever sent: 1 advanced,
// 1 rejected, 8 still silent. Conversion is 1/10, not 1/25 and not 9/10.
const mixed = withOutcomeRates({ ...newOutcomeCounts(), total: 25, positive: 1, negative: 1, awaiting: 8, pending: 15 });
if (mixed.submitted === 10) pass('submitted counts positive + negative + awaiting (never-sent rows excluded)');
else fail(`submitted → ${mixed.submitted}, expected 10`);

if (mixed.conversionRate === 10) pass('conversionRate divides by submitted, not by total');
else fail(`conversionRate → ${mixed.conversionRate}, expected 10 (dividing by total would give 4)`);

if (mixed.decidedRate === 50) pass('decidedRate divides by decided outcomes only');
else fail(`decidedRate → ${mixed.decidedRate}, expected 50`);

// A segment nobody has answered yet is "no data", not "0% — avoid this".
// Reporting 0 here is how a promising lane gets retired on silence alone.
const silent = withOutcomeRates({ ...newOutcomeCounts(), total: 3, awaiting: 3 });
if (silent.decidedRate === null) pass('decidedRate is null while nothing is decided, not 0');
else fail(`decidedRate on an all-awaiting segment → ${silent.decidedRate}, expected null`);

// An untouched segment must not divide by zero.
const empty = withOutcomeRates(newOutcomeCounts());
if (empty.submitted === 0 && empty.conversionRate === 0 && empty.decidedRate === null) {
  pass('an empty segment yields 0 submitted, 0% conversion and a null decidedRate');
} else {
  fail(`empty segment → ${JSON.stringify({ s: empty.submitted, c: empty.conversionRate, d: empty.decidedRate })}`);
}

// The all-positive case must still read as 100%, so the fix cannot be mistaken
// for "always deflate the number".
const perfect = withOutcomeRates({ ...newOutcomeCounts(), total: 2, positive: 2 });
if (perfect.conversionRate === 100 && perfect.decidedRate === 100) pass('a fully-converting segment still reads 100%');
else fail(`perfect segment → conversion ${perfect.conversionRate}%, decided ${perfect.decidedRate}%`);

// `decided` is a count on the row, because the recommendation gates must read
// facts, not a rounded percentage: 1 advance out of 201 decided rounds to 0%
// and is still not "none advanced".
const lopsided = withOutcomeRates({ ...newOutcomeCounts(), total: 201, positive: 1, negative: 200 });
if (lopsided.decided === 201 && lopsided.decidedRate === 0) pass('decided is exposed as a count next to the rounded decidedRate');
else fail(`lopsided segment → decided ${lopsided.decided}, decidedRate ${lopsided.decidedRate}`);

// --- end to end through analyze() --------------------------------------------
// --- recommendation selectors ---------------------------------------------
// Both prescriptions gate on DECIDED outcomes: employer silence is evidence in
// neither direction, and the list order (largest `total` first) must not decide
// which segment gets named.
const seg = (label, positive, negative, awaiting, pending = 0) =>
  ({ label, ...withOutcomeRates({ total: positive + negative + awaiting + pending, positive, negative, awaiting, discarded: 0, self_filtered: 0, pending }) });

const quietLane = seg('quiet', 3, 1, 10);              // 3 of 4 decided advanced (75%), 21% of everything sent
const loudLane = seg('loud', 5, 5, 0);                 // 5 of 10 decided advanced (50%), 50% of everything sent
if (bestDecidedSegment([loudLane, quietLane])?.label === 'quiet') pass('"double down" ranks by decidedRate (75% of 4 beats 50% of 10), not by conversionRate (which would pick the loud lane)');
else fail(`bestDecidedSegment picked ${JSON.stringify(bestDecidedSegment([loudLane, quietLane]))}`);
if (bestDecidedSegment([seg('rare', 1, 200, 0)]) === null) pass('"double down" skips a lane whose decided rate rounds to 0% (1 of 201 is not a pattern to lean into)');
else fail('bestDecidedSegment prescribed a 0% lane');
const oneDecided = seg('niche', 1, 0, 1);              // 1 positive + 1 awaiting: 100% decided, n=1
if (bestDecidedSegment([oneDecided]) === null) pass('"double down" needs at least 2 decided outcomes (one employer answer is not a pattern)');
else fail('bestDecidedSegment prescribed on a single decided outcome');

const bigQuiet = seg('hybrid', 0, 2, 0, 14);           // total 16, decided 2
const smallLoud = seg('geo', 0, 6, 0);                 // total 6, decided 6
if (worstDecidedSegment([bigQuiet, smallLoud])?.label === 'geo') pass('"avoid" names the segment with the most decided losses, not the largest total');
else fail(`worstDecidedSegment picked ${JSON.stringify(worstDecidedSegment([bigQuiet, smallLoud]))}`);
if (worstDecidedSegment([seg('x', 0, 1, 4)]) === null) pass('"avoid" needs at least 2 decided outcomes (1 rejection + 4 unanswered is not a pattern)');
else fail('worstDecidedSegment fired on a single rejection');
if (worstDecidedSegment([seg('y', 1, 200, 0)]) === null) pass('"avoid" reads the positive count, not a rounded 0% rate (1 of 201 advanced)');
else fail('worstDecidedSegment fired on 1 positive of 201 decided');

// --- score threshold ----------------------------------------------------------
// The lowest positive score is an observation; it is a threshold only when the
// sample is big enough AND something decided below it actually failed.
const thin = scoreThresholdFrom([4.2], [3.8, 3.0]);
if (thin.recommended === null && thin.observedMinimum === 4.2 && thin.sufficientSample === false) pass('one positive score is an observation, never a threshold');
else fail(`thin sample → ${JSON.stringify(thin)}`);
const vacuous = scoreThresholdFrom([4.2, 4.4, 4.6], [4.5, 4.8]);
if (vacuous.recommended === null && vacuous.sufficientSample === true && vacuous.rejectedBelow === 0 && /no rejected application scored below/.test(vacuous.reasoning)) {
  pass('three positives with no rejection below the floor stay an observation ("nothing below X advanced" would be vacuous)');
} else {
  fail(`vacuous floor → ${JSON.stringify(vacuous)}`);
}
const earned = scoreThresholdFrom([4.25, 4.4, 4.6], [3.8, 4.5, 3.0]);
if (earned.recommended === 4.2 && earned.rejectedBelow === 2 && /2 rejected application\(s\) did/.test(earned.reasoning)) pass('three positives and two rejections below the floor earn a recommended threshold (floored to 0.1)');
else fail(`earned floor → ${JSON.stringify(earned)}`);

// --- end-to-end over a fixture tracker ---------------------------------------
// The helpers above can be right while a breakdown still divides by `total`, or
// while metadata forgets a bucket, or while a recommendation gate reads the
// rounded rate. Only a real run over a real tracker catches that, so build one.
const work = mkdtempSync(join(tmpdir(), 'cops-ap-outcomes-'));
mkdirSync(join(work, 'data'));
mkdirSync(join(work, 'reports'));

const GLOBAL = 'Fully remote, hiring worldwide';
const GEO = 'US-only remote';
const HYBRID = 'Hybrid, 3 days a week in the office';
// [num, status, score, archetype, remote]
// hybrid/onsite = 1 rejection + 4 unanswered + 1 withdrawn: the largest bucket by
// total, ONE decided outcome — "avoid" must skip it and name geo-restricted (2).
const ROWS = [
  [1,  'Applied',   '4.0', 'AI Engineer', GLOBAL],
  [2,  'Applied',   '3.5', 'AI Engineer', GLOBAL],
  [3,  'Responded', '4.2', 'AI Engineer', GLOBAL],
  [4,  'Rejected',  '3.8', 'AI Engineer', GEO],
  [5,  'Evaluated', '4.5', 'AI Engineer', GLOBAL],
  [6,  'Rejected',  '3.0', 'Backend',     GEO],
  [7,  'Applied',   '3.6', 'Backend',     GEO],
  [8,  'Rejected',  '3.2', 'Backend',     HYBRID],
  [9,  'Applied',   '3.4', 'Backend',     HYBRID],
  [10, 'Applied',   '3.3', 'Backend',     HYBRID],
  [11, 'Applied',   '3.1', 'Backend',     HYBRID],
  [12, 'Applied',   '3.7', 'Backend',     HYBRID],
  [13, 'Discarded', '3.9', 'Backend',     HYBRID],
];
const trackerLines = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];
for (const [num, status, score, archetype, remote] of ROWS) {
  const file = `${String(num).padStart(3, '0')}-co${num}-2026-01-01.md`;
  writeFileSync(join(work, 'reports', file), [
    `# Evaluation: Co${num} — ${archetype}`, '',
    '## Machine Summary', '',
    '```yaml',
    `company: "Co${num}"`,
    `role: "${archetype}"`,
    `score: ${score}`,
    `archetype: "${archetype}"`,
    `remote: "${remote}"`,
    '```', '',
  ].join('\n'));
  trackerLines.push(`| ${num} | 2026-01-01 | Co${num} | ${archetype} | ${score}/5 | ${status} | ❌ | [${num}](../reports/${file}) | fixture |`);
}
writeFileSync(join(work, 'data', 'applications.md'), trackerLines.join('\n') + '\n');

let result = null;
let summary = '';
let gated = null;
try {
  const run = (...flags) => execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), ...flags], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_ROOT: work },
  });
  result = JSON.parse(run('--min-threshold', '1'));
  summary = run('--min-threshold', '1', '--summary');
  // Below the floor the script prints its JSON and exits 1.
  try { run('--min-threshold', '12'); } catch (e) { gated = JSON.parse(e.stdout || 'null'); }
} catch (e) {
  fail(`analyze-patterns.mjs did not run over the fixture tracker: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (gated && gated.error && gated.current === 11 && gated.threshold === 12) pass('the data floor counts sent applications only (11 of 13 rows: not the Evaluated or Discarded ones)');
else fail(`--min-threshold 12 over 11 sent rows → ${JSON.stringify(gated)}`);

if (result) {
  const buckets = OUTCOME_BUCKETS;
  const byOutcome = result.metadata?.byOutcome || {};
  if (JSON.stringify(Object.keys(byOutcome)) === JSON.stringify(buckets)) pass('metadata.byOutcome carries exactly the declared outcome buckets, in lifecycle order');
  else fail(`metadata.byOutcome keys = ${Object.keys(byOutcome).join(',')}`);
  if (byOutcome.awaiting === 7 && byOutcome.positive === 1 && byOutcome.negative === 3 && byOutcome.discarded === 1 && byOutcome.pending === 1) {
    pass('seven Applied rows land in awaiting, the Discarded row in discarded; the one Responded row is the only positive');
  } else {
    fail(`byOutcome = ${JSON.stringify(byOutcome)}`);
  }
  const rates = result.metadata?.outcomeRates || {};
  if (rates.submitted === 11 && rates.decided === 4 && rates.conversionRate === 9 && rates.decidedRate === 25) {
    pass('metadata.outcomeRates quotes the whole tracker through the same denominators (1 of 11 sent, 1 of 4 decided)');
  } else {
    fail(`metadata.outcomeRates = ${JSON.stringify(rates)}`);
  }

  if (JSON.stringify(Object.keys(result.scoreComparison || {}).sort()) === JSON.stringify([...buckets].sort())
      && result.scoreComparison.awaiting?.count === 7) {
    pass('scoreComparison has an awaiting group with the seven Applied scores');
  } else {
    fail(`scoreComparison = ${JSON.stringify(result.scoreComparison)}`);
  }

  const ai = (result.archetypeBreakdown || []).find((a) => a.archetype === 'AI Engineer');
  // 5 rows, 4 sent (2 awaiting, 1 positive, 1 negative), 1 never sent.
  if (ai && ai.total === 5 && ai.submitted === 4 && ai.awaiting === 2 && ai.decided === 2
      && ai.conversionRate === 25 && ai.decidedRate === 50) {
    pass('archetype breakdown: 1 of 4 sent converted → 25%, not 3 of 5 "positive" → 60%');
  } else {
    fail(`AI Engineer archetype row = ${JSON.stringify(ai)}`);
  }

  const geo = (result.remotePolicy || []).find((r) => r.policy === 'geo-restricted');
  const hybrid = (result.remotePolicy || []).find((r) => r.policy === 'hybrid/onsite');
  const globalRow = (result.remotePolicy || []).find((r) => r.policy === 'global remote');
  if (geo && geo.submitted === 3 && geo.decided === 2 && geo.positive === 0 && geo.decidedRate === 0
      && hybrid && hybrid.total === 6 && hybrid.submitted === 5 && hybrid.decided === 1 && hybrid.discarded === 1 && hybrid.decidedRate === 0
      && globalRow && globalRow.submitted === 3 && globalRow.decided === 1 && globalRow.decidedRate === 100) {
    pass('remote policy rows expose submitted / decided / decidedRate per bucket, and a Discarded row is neither submitted nor decided');
  } else {
    fail(`remote rows = ${JSON.stringify({ geo, hybrid, globalRow })}`);
  }
  const sizes = result.companySizeBreakdown || [];
  if (sizes.length === 1 && 'size' in sizes[0] && sizes[0].submitted === 11 && sizes[0].decided === 4 && sizes[0].decidedRate === 25) {
    pass('company-size breakdown uses the same denominators (the fixture has one size bucket)');
  } else {
    fail(`companySizeBreakdown = ${JSON.stringify(sizes)}`);
  }

  const actions = (result.recommendations || []).map((r) => r.action);
  const avoid = actions.filter((a) => a.startsWith('Avoid '));
  if (avoid.length === 1 && /geo-restricted/.test(avoid[0]) && /0 of 2 decided/.test(avoid[0])) {
    pass('"Avoid" fires for the bucket with 2 decided losses and names the decided count');
  } else {
    fail(`Avoid recommendations = ${JSON.stringify(avoid)}`);
  }
  if (!avoid.some((a) => /hybrid/.test(a))) pass('"Avoid" does NOT fire on 1 rejection + 4 unanswered applications (decided < 2)');
  else fail('"Avoid" fired for hybrid/onsite on a single decided outcome');

  const doubleDown = actions.find((a) => a.startsWith('Double down'));
  if (doubleDown && /AI Engineer/.test(doubleDown) && /50% of decided outcomes advanced, 25% of all sent/.test(doubleDown)) {
    pass('"Double down" names AI Engineer (1 of 2 decided) and quotes both rates, never the total-based 60%');
  } else {
    fail(`Double down recommendation = ${JSON.stringify(doubleDown)}`);
  }

  const st = result.scoreThreshold || {};
  if (st.sampleSize === 1 && st.sufficientSample === false && st.recommended === null && st.observedMinimum === 4.2
      && !actions.some((a) => /Set minimum score threshold/.test(a))) {
    pass('one scored positive outcome yields an observedMinimum, a null recommended threshold and no threshold recommendation');
  } else {
    fail(`scoreThreshold = ${JSON.stringify(st)}; actions = ${JSON.stringify(actions)}`);
  }
  if (/SCORE OBSERVATION: lowest positive 4.2\/5 \(n=1; not a threshold yet\)/.test(summary) && !/SCORE THRESHOLD/.test(summary)) {
    pass('--summary withholds the SCORE THRESHOLD headline on a 1-outcome sample and prints it as an observation');
  } else {
    fail(`--summary threshold lines = ${JSON.stringify((summary.match(/SCORE [A-Z]+.*/g) || []))}`);
  }
  if (/hybrid\/onsite\s+5 sent, 4 awaiting, 0 positive of 1 decided \(0%\)/.test(summary)) {
    pass('--summary remote row prints sent / awaiting / positive-of-decided per bucket');
  } else {
    fail(`--summary remote rows = ${JSON.stringify((summary.match(/^\s+(global remote|geo-restricted|hybrid\/onsite).*/gm) || []))}`);
  }
}
