/**
 * tests/salary-gap-aggregate-n.test.mjs — a per-currency mean carries its own n.
 *
 * byCurrency's mean and median advertised→actual, and atOrAboveAdvertised,
 * cover only the actuals that also have an advertised figure in the same
 * currency: usually a minority, since most reports carry no advertised_comp.
 * The fold deleted the list it averaged, so `confirmed` (every actual) was the
 * only count left, and four EUR offers with one advertised figure printed
 * "EUR: mean advertised->actual -20.0%, median -20.0%, at/above advertised 0":
 * one offer's gap shown as if it were all four's.
 *
 * Run: node test-all.mjs --only salary-gap-aggregate-n
 */
import { parseObservations, fold } from '../salary-gap.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary-gap per-currency aggregates keep their sample size');

const assert = (cond, name) => (cond ? pass(name) : fail(name));
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const row = (...cells) => cells.join(TAB);

const apps = {
  1: { company: 'Acme', role: 'Eng' },
  2: { company: 'Beta', role: 'Eng' },
  3: { company: 'Gama', role: 'Eng' },
  4: { company: 'Delta', role: 'Eng' },
};
// Four EUR actuals; only #1 has an advertised figure, and only #2 a desired one.
const observations = [
  row('1', '2026-07-01', 'advertised', '100k', 'EUR', 'jd', ''),
  row('1', '2026-07-10', 'actual', '80k', 'EUR', 'offer-letter', ''),
  row('2', '2026-07-01', 'desired', '90k', 'EUR', 'user', ''),
  row('2', '2026-07-10', 'actual', '95k', 'EUR', 'offer-letter', ''),
  row('3', '2026-07-10', 'actual', '70k', 'EUR', 'offer-letter', ''),
  row('4', '2026-07-10', 'actual', '75k', 'EUR', 'offer-letter', ''),
].join(NL);

const eur = fold(parseObservations(observations), apps, null).aggregates.byCurrency.EUR;

assert(eur && eur.confirmed === 4, 'premise: all four actuals are confirmed');
assert(eur.advertisedCompared === 1 && eur.meanAdvToActPct === -20 && eur.medianAdvToActPct === -20,
  'the -20% mean and median carry advertisedCompared: 1, not the 4 confirmed');
assert(eur.atOrAboveAdvertised === 0, 'at/above advertised counts within those same comparisons');
assert(eur.desiredCompared === 1 && eur.atOrAboveDesired === 1,
  'at/above desired carries its own n (desiredCompared: 1)');

// No advertised figure at all: n is 0 and the mean is absent, not 0%.
const none = fold(parseObservations(row('3', '2026-07-10', 'actual', '70k', 'EUR', 'offer-letter', '')), apps, null)
  .aggregates.byCurrency.EUR;
assert(none.advertisedCompared === 0 && none.meanAdvToActPct === null && none.desiredCompared === 0,
  'with nothing to compare, n is 0 and the mean is null');

// --summary: the line the user reads says what the mean is over.
{
  const root = mkdtempSync(join(tmpdir(), 'sg-aggregate-n-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-07-01 | Acme | Eng | 4.0/5 | Offer | n | - | n |',
      '| 2 | 2026-07-01 | Beta | Eng | 4.0/5 | Offer | n | - | n |',
      '| 3 | 2026-07-01 | Gama | Eng | 4.0/5 | Offer | n | - | n |',
      '| 4 | 2026-07-01 | Delta | Eng | 4.0/5 | Offer | n | - | n |',
    ].join(NL) + NL);
    writeFileSync(join(root, 'data', 'salary-observations.tsv'), observations + NL);
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'salary-gap.mjs');
    const out = spawnSync(process.execPath, [script, '--summary'], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '', CAREER_OPS_PROFILE: '' },
    });
    const line = (out.stdout || '').split(NL).find((l) => l.trim().startsWith('EUR:')) || '';
    assert(out.status === 0
      && line.includes('4 confirmed actuals')
      && line.includes('advertised→actual over 1: mean -20.0%, median -20.0%')
      && line.includes('at/above advertised 0 of 1')
      && line.includes('at/above desired 1 of 1'),
      `--summary names the n each figure is over: ${JSON.stringify(line || out.stdout)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
