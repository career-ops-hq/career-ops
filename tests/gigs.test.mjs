// tests/gigs.test.mjs — gigs.mjs lists the tracker rows that carry a gig segment in Notes (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/gigs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGigNote, listGigs } from '../gigs.mjs';
import { normalizeTracks } from '../lib/tracks.mjs';

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-11-02 | Acme | LLM Engineer (Freelance) | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-11-02.md) | gig: 100 EUR/h, 6 mo, via Hays; posted: 2026-11-02 |',
  '| 2 | 2026-11-02 | Globex | Staff Engineer | 4.0/5 | Applied | ✅ | [2](reports/002-globex-2026-11-02.md) | Good fit |',
  '| 3 | 2026-11-03 | Initech | Agent Engineer | 3.9/5 | Applied | ❌ | [3](reports/003-initech-2026-11-03.md) | gig: rate n/s, length n/s, direct |',
  '| 4 | 2026-11-03 | Hooli | AI Consultant | 4.1/5 | Interview | ❌ | [4](reports/004-hooli-2026-11-03.md) | gig: £600/day, 12 weeks, direct |',
].join('\n');

test('the gig segment: rate, length and agency', () => {
  assert.deepEqual(parseGigNote('gig: 850 EUR/day, 6 mo, via Hays; posted: 2026-11-02'), {
    rate: { min: 850, max: 850, currency: 'EUR', unit: 'day' }, months: 6, via: 'Hays', direct: false, raw: '850 EUR/day, 6 mo, via Hays',
  });
  const range = parseGigNote('gig: 90-110 €/h, 12 weeks, direct');
  assert.deepEqual([range.rate.min, range.rate.max, range.rate.unit, range.rate.currency, range.months, range.direct], [90, 110, 'hour', 'EUR', 2.8, true]);
  assert.equal(parseGigNote('gig: 95 € pro Std, 3 Monate, direkt').rate.unit, 'hour');
});

test('what the segment does not state stays null', () => {
  const g = parseGigNote('gig: rate n/s, length n/s, via Malt');
  assert.deepEqual([g.rate, g.months, g.via], [null, null, 'Malt']);
});

test('an ordinary note is not a gig', () => {
  for (const notes of ['Strong fit; posted: 2026-11-02', '', null, 'Mentions a gig: maybe']) assert.equal(parseGigNote(notes), null);
});

test('gig rows are listed with day rate, contract value and target comparison', () => {
  const tracks = normalizeTracks({ tracks: { freelance: { enabled: true, day_rate: { target: 900, minimum: 700, currency: 'EUR' }, billable_days_per_year: 200 } } });
  const r = listGigs(TRACKER, tracks);
  assert.equal(r.count, 3);
  assert.deepEqual(r.byStatus, { Evaluated: 1, Applied: 1, Interview: 1 });
  const [acme, initech, hooli] = r.rows;
  assert.deepEqual([acme.dayRate.min, acme.contractValue.min, acme.via, acme.againstTarget], [800, 80000, 'Hays', 'between']);
  assert.deepEqual([initech.dayRate, initech.contractValue, initech.direct, initech.againstTarget], [null, null, true, 'not_stated']);
  assert.equal(hooli.dayRate.currency, 'GBP');
  assert.equal(hooli.againstTarget, 'unknown', 'no conversion rate configured, no comparison');
});

test('with no rate configured nothing is judged', () => {
  const r = listGigs(TRACKER, normalizeTracks(null));
  assert.equal(r.rows[0].againstTarget, 'no_floor');
  assert.equal(listGigs('', normalizeTracks(null)).count, 0);
});
