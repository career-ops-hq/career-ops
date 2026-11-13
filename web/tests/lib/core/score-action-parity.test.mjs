// The web copy of the score-to-action table must agree with lib/score-action.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCodeRoot } from '../../../src/lib/core/code-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(HERE, '..', '..', '..', 'src', 'lib', 'core', 'score-action.mjs');
const CORE = path.join(resolveCodeRoot(path.join(HERE, '..', '..', '..'), {}), 'lib', 'score-action.mjs');

const mirror = await import(pathToFileURL(MIRROR).href);
const core = await import(pathToFileURL(CORE).href);

const SCORES = [0, 2.9, 3, 3.4, 3.5, 3.9, 4, 4.4, 4.5, 5, -1, 5.1, Number.NaN, null];

test('band, recommendation, triage, and PDF gate match the root table', () => {
  assert.deepEqual(mirror.SCORE_BANDS, core.SCORE_BANDS);
  assert.equal(mirror.SCORE_MIN, core.SCORE_MIN);
  assert.equal(mirror.SCORE_MAX, core.SCORE_MAX);
  assert.equal(mirror.APPLY_MIN, core.APPLY_MIN);
  assert.equal(mirror.STRONG_APPLY_MIN, core.STRONG_APPLY_MIN);
  assert.equal(mirror.MAYBE_MIN, core.MAYBE_MIN);
  assert.equal(mirror.TRIAGE_PASS_MIN, core.TRIAGE_PASS_MIN);
  assert.equal(mirror.PDF_GATE_DEFAULT, core.PDF_GATE_DEFAULT);
  for (const score of SCORES) {
    assert.deepEqual(mirror.bandForScore(score), core.bandForScore(score), `band ${score}`);
    assert.equal(mirror.recommendationFor(score), core.recommendationFor(score), `decision ${score}`);
    assert.equal(
      mirror.recommendationFor(score, { hardStop: true, suspicious: true }),
      core.recommendationFor(score, { hardStop: true, suspicious: true }),
    );
    assert.equal(mirror.triageVerdict(score), core.triageVerdict(score), `triage ${score}`);
    assert.equal(mirror.triageVerdict(score, 4), core.triageVerdict(score, 4));
    assert.equal(mirror.pdfGateAllows(score), core.pdfGateAllows(score), `pdf ${score}`);
    assert.equal(mirror.pdfGateAllows(score, 0), core.pdfGateAllows(score, 0));
  }
});
