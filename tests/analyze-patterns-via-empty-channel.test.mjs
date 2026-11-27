// tests/analyze-patterns-via-empty-channel.test.mjs — a via channel nothing
// went through has no advance rate.
//
// buildViaChannelAnalysis() returned 0 for the advance rate of an empty
// channel (decidedRate, a few functions over, is null in the same case), and
// the summary printed it: a user who only applies through agencies saw
// "direct    0 apps    0% advance", a direct channel apparently tried and
// failed. A rate over no submissions is absent.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

/** Five submissions, two advanced, all through `via`; returns the JSON and the summary. */
function analyze(via) {
  const root = mkdtempSync(join(tmpdir(), 'ap-via-empty-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    const rows = [1, 2, 3, 4, 5].map((i) =>
      `| ${i} | 2026-01-0${i} | Co${i} | Engineer | 4.0/5 | ${i <= 2 ? 'Interview' : 'Rejected'} | ❌ | — | n | ${via} |`);
    writeFileSync(join(root, 'data', 'applications.md'), ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Via |',
      '|---|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
    const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '' };
    const run = (extra) => execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), '--min-threshold', '1', ...extra], { encoding: 'utf-8', env, timeout: 60000 });
    return { json: JSON.parse(run([])).viaChannelAnalysis, summary: run(['--summary']) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\nanalyze-patterns — an empty via channel has no advance rate');

ok('agency-only: the direct channel has no rate, the agency channel has its own', () => {
  const { json, summary } = analyze('Hays');
  assert.strictEqual(json.directSubmitted, 0, 'premise: nothing went direct');
  assert.strictEqual(json.directAdvanceRate, null);
  assert.strictEqual(json.agencyAdvanceRate, 40);
  assert.match(summary, /direct\s+0 apps\s+— advance/);
  assert.doesNotMatch(summary, /direct\s+0 apps\s+0% advance/);
  assert.match(summary, /agency\s+5 apps\s+40% advance/);
});

ok('direct-only: the agency channel has no rate', () => {
  const { json, summary } = analyze('—');
  assert.strictEqual(json.agencySubmitted, 0, 'premise: nothing went through an agency');
  assert.strictEqual(json.agencyAdvanceRate, null);
  assert.strictEqual(json.directAdvanceRate, 40);
  assert.match(summary, /agency\s+0 apps\s+— advance/);
});
