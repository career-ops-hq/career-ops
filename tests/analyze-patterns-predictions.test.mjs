// Predicted skip reasons and recorded reasons describe different events. Keep
// their populations separate, and never turn an absent forecast into a verdict.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { buildPredictedDiscardReasonSignals, OUTCOME_BUCKETS } from '../analyze-patterns.mjs';

console.log('\nanalyze-patterns — predicted reasons remain separate from outcomes');

function check(name, fn) {
  try { fn(); pass(name); }
  catch (error) { fail(`${name}: ${error.message}`); }
}

const entry = (raw, outcome = 'pending', notes = '') => ({
  outcome, notes,
  report: {
    machineSummary: { discard_reasons: raw },
    discardReasons: Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [],
  },
});

check('an empty population has no predictions and a zero base', () => {
  const result = buildPredictedDiscardReasonSignals([]);
  assert.equal(result.predictedDiscardReasonBase, 0);
  assert.deepEqual(result.predictedDiscardReasonStats, []);
  assert.ok(Object.values(result.discardReasonCoverage).every(value => value === 0));
});

check('empty lists are known-none; absent, null and malformed prediction data remain unknown', () => {
  const input = [entry([]), entry(undefined), entry(null), entry({ reason: 'noise' }), entry(['valid', { reason: 'noise' }]), entry(42), { outcome: 'pending', report: null }];
  const result = buildPredictedDiscardReasonSignals(input);
  assert.equal(result.predictedDiscardReasonBase, 1);
  assert.deepEqual(result.predictedDiscardReasonStats, []);
  assert.equal(result.discardReasonCoverage.entriesWithReports, 6);
  assert.equal(result.discardReasonCoverage.entriesWithPredictions, 0);
});

check('forecasts survive every later outcome, including positive and unanswered applications', () => {
  const result = buildPredictedDiscardReasonSignals(OUTCOME_BUCKETS.map(outcome => entry(['geo_restriction'], outcome)));
  assert.equal(result.predictedDiscardReasonBase, OUTCOME_BUCKETS.length);
  assert.deepEqual(result.predictedDiscardReasonStats, [{ reason: 'geo_restriction', frequency: OUTCOME_BUCKETS.length, percentage: 100 }]);
});

check('canonical ids match by spelling only and deduplicate within each entry', () => {
  const input = [entry([' Salary too low ', 'SALARY-TOO-LOW', 'salary_too_low', '']), entry([]), entry('Geo restriction')];
  const before = JSON.stringify(input);
  const result = buildPredictedDiscardReasonSignals(input);
  assert.equal(result.predictedDiscardReasonBase, 3);
  assert.deepEqual(result.predictedDiscardReasonStats, [
    { reason: 'geo_restriction', frequency: 1, percentage: 33 },
    { reason: 'salary_too_low', frequency: 1, percentage: 33 },
  ]);
  assert.deepEqual(result.predictedDiscardReasonOther, { vocabularyLoaded: true, entries: 0, percentage: 0, reasons: [] });
  assert.equal(JSON.stringify(input), before);
});

check('labels outside the vocabulary are listed as other with their spelling and never enter the shares', () => {
  const input = [entry([' Visa ', 'VISA', 'visa_unconfirmed', 'Équipe trop petite', 'salary_too_low']), entry([]), entry('visa'), entry(['salary_too_low_unconfirmed'])];
  const result = buildPredictedDiscardReasonSignals(input);
  assert.equal(result.predictedDiscardReasonBase, 4);
  assert.deepEqual(result.predictedDiscardReasonStats, [{ reason: 'salary_too_low', frequency: 1, percentage: 25 }]);
  const other = result.predictedDiscardReasonOther;
  assert.equal(other.entries, 3);
  assert.equal(other.percentage, 75);
  assert.deepEqual(other.reasons.find(row => row.reason === 'visa'), { reason: 'visa', frequency: 2 });
  assert.equal(other.reasons.find(row => row.reason === 'visa_unconfirmed').frequency, 1);
  assert.equal(other.reasons.find(row => row.reason === 'équipe trop petite').frequency, 1);
  // No synonym guessing: a near-miss of a canonical id stays other.
  assert.equal(other.reasons.find(row => row.reason === 'salary_too_low_unconfirmed').frequency, 1);
});

check('an unreadable vocabulary reports every label as other instead of guessing one', () => {
  const result = buildPredictedDiscardReasonSignals([entry(['salary_too_low', 'visa'])], null);
  assert.deepEqual(result.predictedDiscardReasonStats, []);
  assert.equal(result.predictedDiscardReasonOther.vocabularyLoaded, false);
  assert.deepEqual(result.predictedDiscardReasonOther.reasons.map(row => row.reason).sort(), ['salary_too_low', 'visa']);
});

check('recorded-reason coverage honors the existing outcome eligibility and counts explicit empty forecasts', () => {
  const result = buildPredictedDiscardReasonSignals([
    entry(['forecast'], 'positive', 'SKIP: not an actual skip'),
    entry([], 'self_filtered', 'SKIP: manual; DISCARD: manual'),
    entry(undefined, 'negative', 'DISCARD: manual'),
    { outcome: 'discarded', report: null, notes: 'SKIP: manual' },
  ]);
  assert.equal(result.discardReasonCoverage.entriesWithRecordedReasons, 3);
  assert.equal(result.discardReasonCoverage.entriesWithBothSources, 1);
  assert.equal(result.discardReasonCoverage.entriesWithPredictions, 1);
});

// Exercise report parsing, JSON publication and the human summary through the
// real CLI. Two tracker rows intentionally link the same report: these counts
// describe tracker entries, not unique report files.
const work = mkdtempSync(join(tmpdir(), 'cops-pattern-predictions-'));
mkdirSync(join(work, 'data'));
mkdirSync(join(work, 'reports'));
const files = new Map();
function writeFixture(file, content) {
  writeFileSync(file, content);
  files.set(file, content);
}
const rows = [
  [1, 'Rejected', ['salary_too_low', ' SALARY_TOO_LOW ', 'remote_mismatch'], 'DISCARD: salary_too_low; SKIP: SALARY_TOO_LOW'],
  [2, 'SKIP', [], 'SKIP: manual'],
  [3, 'Discarded', undefined, 'DISCARD: manual'],
  [4, 'Interview', 'visa', 'SKIP: ignored_positive'],
  [5, 'Applied', ['salary_too_low_unconfirmed'], ''],
  [6, 'Evaluated', ['Équipe trop petite'], 'SKIP: ignored_pending'],
  [7, 'Offer', [{ reason: 'invalid' }], ''],
  [8, 'Rejected', undefined, 'DISCARD: manual'], // report is missing
  [9, 'Hired', undefined, ''],
  [10, 'Rejected', undefined, ''], // shares report 1
  [11, 'Applied', undefined, ''], // malformed Machine Summary
];
const tracker = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];
for (const [num, status, reasons, notes] of rows) {
  const reportNum = num === 10 ? 1 : num;
  const filename = `${String(reportNum).padStart(3, '0')}-fixture-2026-01-01.md`;
  tracker.push(`| ${num} | 2026-01-01 | Fixture ${num} | Engineer | 4.0/5 | ${status} | ❌ | [${reportNum}](../reports/${filename}) | ${notes} |`);
  if (num === 8 || num === 10) continue;
  const machine = { company: `Fixture ${num}`, role: 'Engineer', score: 4, discard_reasons: reasons };
  writeFixture(join(work, 'reports', filename), [
    `# Evaluation: Fixture ${num}`, '', '## Machine Summary', '', '```yaml',
    num === 11 ? 'discard_reasons: [unterminated' : JSON.stringify(machine), '```', '',
  ].join('\n'));
}
writeFixture(join(work, 'data', 'applications.md'), tracker.join('\n') + '\n');

try {
  const run = (...flags) => execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), '--min-threshold', '1', ...flags], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_DATA_DIR: work },
  });
  const result = JSON.parse(run());
  const summary = run('--summary');

  check('CLI JSON publishes prediction shares over explicit data, counting entries that share a report', () => {
    assert.equal(result.predictedDiscardReasonBase, 6);
    assert.deepEqual(result.predictedDiscardReasonStats, [{ reason: 'salary_too_low', frequency: 2, percentage: 33 }]);
    const other = result.predictedDiscardReasonOther;
    assert.equal(other.entries, 5);
    assert.equal(other.percentage, 83);
    assert.deepEqual(other.reasons.find(row => row.reason === 'remote_mismatch'), { reason: 'remote_mismatch', frequency: 2 });
    assert.equal(other.reasons.find(row => row.reason === 'visa').frequency, 1);
    assert.ok(![...result.predictedDiscardReasonStats, ...other.reasons].some(row => row.reason.includes('object')));
  });
  check('CLI coverage exposes missing reports, missing predictions and missing recorded reasons separately', () => {
    assert.deepEqual(result.discardReasonCoverage, {
      entriesWithReports: 10, entriesWithPredictionData: 6, entriesWithPredictions: 5,
      entriesWithRecordedReasons: 4, entriesWithBothSources: 2,
    });
  });
  check('recorded stats keep their own denominator and never include predicted-only labels', () => {
    assert.equal(result.discardReasonBase, 5);
    assert.deepEqual(result.discardReasonStats, [
      { reason: 'manual', frequency: 3, percentage: 60 },
      { reason: 'salary_too_low', frequency: 1, percentage: 20 },
    ]);
  });
  check('summary distinguishes forecasts, recorded reasons and their populations without a disagreement claim', () => {
    assert.match(summary, /PREDICTED DISCARD \/ SKIP REASONS \(of 6 entries with prediction data\)/);
    assert.match(summary, /Prediction data: 6\/10 entries with linked reports; 5 contain reasons/);
    assert.match(summary, /Recorded reasons: 4\/5 eligible entries; 2 entries have both sources/);
    assert.match(summary, /Forecasts cover all statuses; recorded reasons cover skipped, discarded, and rejected entries/);
    assert.match(summary, /Predictions are not outcomes\. Missing data is unknown/);
    assert.match(summary, /canonical ids are matched by spelling, not meaning/);
    assert.match(summary, /other \(outside the vocabulary, not counted above\): 5 entries \(83%\)/);
    assert.doesNotMatch(summary, /disagreement|accuracy|false positive/i);
  });
  check('analysis and summary leave every tracker and report byte unchanged', () => {
    for (const [file, content] of files) assert.equal(readFileSync(file, 'utf8'), content);
  });

  // Removing only prediction data must not alter the existing output surface,
  // including filter recommendations. The new series is an observation only.
  for (const [file, content] of files) {
    if (dirname(file) !== join(work, 'reports')) continue;
    writeFileSync(file, content.replace(/"discard_reasons":(?:\[[^\n]*\]|"[^"]*")/, '"unused_predictions":null'));
  }
  const withoutPredictions = JSON.parse(run());
  check('changing predictions cannot change any pre-existing analysis field or recommendation', () => {
    const { predictedDiscardReasonStats, predictedDiscardReasonOther, predictedDiscardReasonBase, discardReasonCoverage, ...before } = result;
    const { predictedDiscardReasonStats: stats, predictedDiscardReasonOther: other, predictedDiscardReasonBase: base, discardReasonCoverage: coverage, ...after } = withoutPredictions;
    assert.deepEqual(after, before);
    assert.equal(base, 0);
  });
  check('summary explains the no-prediction-data case instead of reporting zero predicted risk', () => {
    assert.match(run('--summary'), /No prediction data recorded yet/);
  });
  writeFileSync(join(work, 'reports', '001-fixture-2026-01-01.md'), [
    '# Evaluation: Fixture', '', '## Machine Summary', '', '```json',
    '{"discard_reasons":[]}', '```', '',
  ].join('\n'));
  check('explicit empty forecasts show known-none separately from missing prediction data', () => {
    const knownNone = JSON.parse(run());
    assert.equal(knownNone.predictedDiscardReasonBase, 2); // shared report
    assert.deepEqual(knownNone.predictedDiscardReasonStats, []);
    assert.match(run('--summary'), /No reasons predicted in the recorded data/);
  });
} catch (error) {
  fail(`prediction fixture CLI run failed: ${String(error.stderr || error.message).slice(0, 400)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
