/**
 * tests/jev-inject.test.mjs — the Envelope B compose+inject step (jev-inject.mjs).
 *
 * jev-inject.mjs fuses the Jev envelope (System One bounded enums) with the
 * generative worker's residual prose slots and injects the deterministic
 * `## Machine Summary` block into a finished report. Under test here:
 *   - the slot marker -> composed block replacement works for every placement:
 *     marker-under-heading, bare marker, existing fenced block, and no block
 *     (append);
 *   - Jev wins contested fields (legitimacy_tier, risk_level, work_auth,
 *     archetype, confidence) and risk_summary.legitimacy is derived from Jev;
 *   - a score slot like "4.2/5" coerces to 4.2;
 *   - every failure path is fail-open: status invalid/unavailable, the report
 *     byte-identical, exit 0, never throws.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInject } from '../jev-inject.mjs';
import { extractMachineSummary, composeMachineSummary } from '../lib/jev-machine-summary.mjs';

let tmp;

const SLOTS = {
  company: 'Acme Corp',
  role: 'Senior Applied AI Engineer',
  score: '4.2/5',
  final_decision: 'Apply',
  hard_stops: [],
  soft_gaps: ['Kubernetes operations depth'],
  top_strengths: ['Applied ML in production', 'System design at scale'],
  next_action: 'Send the tailored CV through the careers page',
  discard_reasons: [],
  via: null,
  company_confidential: false,
  advertised_comp: 'EUR 90k-110k base',
  reports_to: 'Head of Applied AI',
  requirement_importance: [
    { requirement: 'Production ML systems', jd_signal: 'You will own model serving at scale', evidence: 'stated', importance: 'critical', match: 'strong' },
    { requirement: 'Fine-tuning in-house LLMs', jd_signal: null, evidence: 'inferred', importance: 'meaningful', match: 'partial' },
  ],
  risk_summary: {
    classification: 'clear',
    culture: 'pass',
    interview_redflags: 'none',
    ai_infra: 'consistent',
    ai_screening_disclosure: 'disclosed',
  },
};

const ENVELOPE = {
  status: 'ok',
  machine: {
    legitimacy_tier: 'Proceed with Caution',
    risk_level: 'Medium',
    work_auth: 'not_needed',
    archetype: 'Applied AI Engineer',
  },
  confidence: 'High',
};

const MARKER_REPORT = `# Acme Corp — Senior Applied AI Engineer

**Archetype:** PLACEHOLDER
**Legitimacy:** PLACEHOLDER
**Score:** 4.2/5

## Analysis

Some prose here.

## Machine Summary

<!-- machine-summary-slot -->

Trailing notes.
`;

function fixture(reportText = MARKER_REPORT) {
  tmp = mkdtempSync(join(tmpdir(), 'jev-inject-'));
  const report = join(tmp, 'report.md');
  const slots = join(tmp, 'slots.json');
  const envelope = join(tmp, 'envelope.json');
  writeFileSync(report, reportText);
  writeFileSync(slots, JSON.stringify(SLOTS));
  writeFileSync(envelope, JSON.stringify(ENVELOPE));
  return { report, slots, envelope };
}

test.afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

test('marker-under-heading is replaced in place with the composed block', () => {
  const { report, slots, envelope } = fixture();
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  assert.equal(res.status, 'done');
  assert.equal(res.mode, 'replaced-slot');
  const text = readFileSync(report, 'utf-8');
  assert.ok(!text.includes('machine-summary-slot'));
  assert.equal((text.match(/## Machine Summary/g) || []).length, 1);
  assert.match(text, /```yaml\n/);
  const parsed = extractMachineSummary(text);
  assert.ok(parsed, 'block parses as YAML');
  const { summary } = composeMachineSummary({ jev: ENVELOPE.machine, slots: SLOTS, jevConfidence: ENVELOPE.confidence });
  assert.deepEqual(parsed, summary);
});

test('Jev wins contested fields and confidence comes from Jev', () => {
  const { report, slots, envelope } = fixture();
  runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  const parsed = extractMachineSummary(readFileSync(report, 'utf-8'));
  assert.equal(parsed.legitimacy_tier, 'Proceed with Caution');
  assert.equal(parsed.risk_level, 'Medium');
  assert.equal(parsed.work_auth, 'not_needed');
  assert.equal(parsed.archetype, 'Applied AI Engineer');
  assert.equal(parsed.confidence, 'High');
  assert.equal(parsed.risk_summary.legitimacy, 'proceed_with_caution');
  assert.equal(parsed.score, 4.2, 'score slot coerces 4.2/5 to 4.2');
});

test('a bare marker (no heading) is replaced', () => {
  const { report, slots, envelope } = fixture('Prose.\n<!-- machine-summary-slot -->\nMore prose.\n');
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  assert.equal(res.status, 'done');
  const text = readFileSync(report, 'utf-8');
  assert.ok(!text.includes('machine-summary-slot'));
  assert.ok(extractMachineSummary(text));
});

test('an existing fenced block without a marker is replaced in place', () => {
  const withExisting = `# R\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: Old Inc\nrole: Old Role\nscore: 1.0\nlegitimacy_tier: Suspicious\narchetype: Old\nfinal_decision: Skip\nhard_stops: []\nsoft_gaps: []\ntop_strengths: []\nrisk_level: High\nconfidence: Low\nnext_action: none\nwork_auth: unstated\ndiscard_reasons: []\nvia: null\ncompany_confidential: false\nadvertised_comp: null\nreports_to: null\nrequirement_importance: []\n\`\`\`\n\nTail\n`;
  const { report, slots, envelope } = fixture(withExisting);
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  assert.equal(res.status, 'done');
  assert.equal(res.mode, 'replaced-existing');
  const parsed = extractMachineSummary(readFileSync(report, 'utf-8'));
  assert.equal(parsed.company, SLOTS.company);
  assert.equal(parsed.legitimacy_tier, 'Proceed with Caution');
});

test('a report with no marker or block gets the block appended', () => {
  const { report, slots, envelope } = fixture('# Just prose\nNo summary anywhere.\n');
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  assert.equal(res.status, 'done');
  assert.equal(res.mode, 'inserted');
  const parsed = extractMachineSummary(readFileSync(report, 'utf-8'));
  assert.equal(parsed.role, SLOTS.role);
});

test('dry-run leaves the report byte-identical', () => {
  const { report, slots, envelope } = fixture();
  const before = readFileSync(report, 'utf-8');
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots, dryRun: true });
  assert.equal(res.status, 'done');
  assert.equal(res.dryRun, true);
  assert.equal(readFileSync(report, 'utf-8'), before);
});

test('fail-open: an invalid slot payload is invalid and leaves the report untouched', () => {
  const { report, slots } = fixture();
  const badSlots = join(tmp, 'bad-slots.json');
  writeFileSync(badSlots, JSON.stringify({ ...SLOTS, requirement_importance: [
    { requirement: 'X', jd_signal: null, evidence: 'stated', importance: 'critical', match: 'strong' },
  ] }));
  const before = readFileSync(report, 'utf-8');
  const res = runInject({ reportPath: report, envelopePath: join(tmp, 'envelope.json'), slotsPath: badSlots });
  assert.equal(res.status, 'invalid');
  assert.ok(res.problems.length > 0);
  assert.equal(readFileSync(report, 'utf-8'), before);
});

test('fail-open: a missing envelope or slots file is unavailable and never throws', () => {
  const { report, slots, envelope } = fixture();
  const noEnv = runInject({ reportPath: report, envelopePath: join(tmp, 'missing.json'), slotsPath: slots });
  assert.equal(noEnv.status, 'unavailable');
  const noReport = runInject({ reportPath: join(tmp, 'nope.md'), envelopePath: envelope, slotsPath: slots });
  assert.equal(noReport.status, 'unavailable');
});

test('fail-open: a report with neither marker nor block still gets a valid composed block', () => {
  const { report, slots, envelope } = fixture('Nothing structured at all.\n');
  const res = runInject({ reportPath: report, envelopePath: envelope, slotsPath: slots });
  assert.equal(res.status, 'done');
  const parsed = extractMachineSummary(readFileSync(report, 'utf-8'));
  assert.equal(typeof parsed.legitimacy_tier, 'string');
});