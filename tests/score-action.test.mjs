// One score-to-action table. The numbers a person sees (apply, maybe, skip,
// triage, PDF, rank clamp) come from lib/score-action.mjs, and the docs and
// callers name that file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLY_MIN,
  MAYBE_MIN,
  PDF_GATE_DEFAULT,
  SCORE_BANDS,
  SCORE_MAX,
  SCORE_MIN,
  STRONG_APPLY_MIN,
  TRIAGE_PASS_MIN,
  bandForScore,
  pdfGateAllows,
  recommendationFor,
  triageVerdict,
} from '../lib/score-action.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('four bands cover 0 to 5 with no gap and no overlap', () => {
  assert.deepEqual(SCORE_BANDS.map((band) => band.id), ['strong_apply', 'apply', 'maybe', 'skip']);
  assert.equal(bandForScore(5).id, 'strong_apply');
  assert.equal(bandForScore(4.5).id, 'strong_apply');
  assert.equal(bandForScore(4.49).id, 'apply');
  assert.equal(bandForScore(4).id, 'apply');
  assert.equal(bandForScore(3.99).id, 'maybe');
  assert.equal(bandForScore(3.5).id, 'maybe');
  assert.equal(bandForScore(3).id, 'maybe');
  assert.equal(bandForScore(2.99).id, 'skip');
  assert.equal(bandForScore(0).id, 'skip');
  assert.equal(bandForScore(-0.1), null);
  assert.equal(bandForScore(5.1), null);
  assert.equal(bandForScore('nope'), null);
  assert.equal(bandForScore(null), null);
});

test('the recommendation follows the band unless a hard stop or a suspicious posting overrides it', () => {
  assert.equal(recommendationFor(4.8), 'Apply');
  assert.equal(recommendationFor(4), 'Apply');
  assert.equal(recommendationFor(3.4), 'Consider');
  assert.equal(recommendationFor(2.2), 'Skip');
  assert.equal(recommendationFor(4.8, { hardStop: true }), 'Skip');
  assert.equal(recommendationFor(4.8, { suspicious: true }), 'Research first');
  assert.equal(recommendationFor(4.8, { hardStop: true, suspicious: true }), 'Skip');
  assert.equal(recommendationFor(9), null);
  assert.equal(recommendationFor(null), null);
  assert.equal(recommendationFor(null, { hardStop: true }), null);
  assert.equal(recommendationFor(null, { suspicious: true }), null);
  assert.equal(recommendationFor(0), 'Skip');
});

test('triage and the PDF gate use the same floors', () => {
  assert.equal(TRIAGE_PASS_MIN, 3.5);
  assert.equal(PDF_GATE_DEFAULT, MAYBE_MIN);
  assert.equal(MAYBE_MIN, 3);
  assert.equal(APPLY_MIN, 4);
  assert.equal(STRONG_APPLY_MIN, 4.5);
  assert.equal(triageVerdict(4.2), 'PASS');
  assert.equal(triageVerdict(3.5), 'PASS');
  assert.equal(triageVerdict(3.4), 'MARGINAL');
  assert.equal(triageVerdict(3), 'MARGINAL');
  assert.equal(triageVerdict(2.9), 'FAIL');
  assert.equal(triageVerdict(3.2, 4), 'MARGINAL');
  assert.equal(triageVerdict(2.9, 4), 'FAIL');
  assert.equal(pdfGateAllows(3), true);
  assert.equal(pdfGateAllows(2.9), false);
  assert.equal(pdfGateAllows(2.9, 0), true);
  assert.equal(pdfGateAllows('nope'), false);
  assert.equal(triageVerdict(null), null);
  assert.equal(pdfGateAllows(null, 0), false);
  assert.equal(pdfGateAllows(0, 0), true);
});

test('the written modes name this table and its numbers', () => {
  const shared = read('modes/_shared.md');
  const triage = read('modes/triage.md');
  const pipeline = read('modes/pipeline.md');
  const batch = read('batch/batch-prompt.md');
  const oferta = read('modes/oferta.md');
  for (const band of SCORE_BANDS) {
    assert.match(shared, new RegExp(band.label));
  }
  assert.match(shared, /4\.5 to 5\.0/);
  assert.match(shared, /4\.0 to 4\.4/);
  assert.match(shared, /3\.0 to 3\.9/);
  assert.match(shared, /below 3\.0/);
  assert.match(shared, /SCORE_MIN/);
  assert.match(shared, /0 and 5/);
  assert.match(shared, /lib\/score-action\.mjs/);
  assert.match(shared, /TRIAGE_PASS_MIN/);
  assert.match(shared, /PDF_GATE_DEFAULT/);
  assert.match(triage, /lib\/score-action\.mjs/);
  assert.match(triage, /TRIAGE_PASS_MIN/);
  assert.match(triage, /3\.5/);
  assert.match(pipeline, /PDF_GATE_DEFAULT/);
  assert.match(pipeline, /auto_pdf_score_threshold/);
  assert.match(batch, /PDF_GATE_DEFAULT/);
  assert.match(oferta, /lib\/score-action\.mjs/);
});

test('rank, the apply warning, and the web copy import this table', () => {
  const rank = read('rank-pipeline.mjs');
  const runner = read('openrouter-runner.mjs');
  assert.match(rank, /from '\.\/lib\/score-action\.mjs'/);
  assert.match(rank, /SCORE_MIN/);
  assert.match(rank, /SCORE_MAX/);
  assert.equal(SCORE_MIN, 0);
  assert.equal(SCORE_MAX, 5);
  assert.doesNotMatch(rank, /Math\.min\(5,\s*Math\.max\(0/);
  assert.match(runner, /from '\.\/lib\/score-action\.mjs'/);
  assert.match(runner, /APPLY_MIN/);
  assert.match(read('web/src/lib/core/score-action.mjs'), /export function bandForScore/);
});
