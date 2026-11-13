// tests/tracks-gig-terms.test.mjs — lib/gig-terms.mjs reads rates, salaries, engagement type and contract terms out of a posting (job-engine search tracks, docs/TRACKS.md).
//
// Run:  node --test tests/tracks-gig-terms.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRates, pickGigRate, pickSalary, toDayRate, convertAmount, compareRate, salaryEquivalentDayRate,
  detectEngagement, parseContractTerms, detectIntermediary, parsePaymentTerms, assessScheinselbstaendigkeit,
} from '../lib/gig-terms.mjs';

const one = text => { const r = parseRates(text); assert.equal(r.length, 1, text); return r[0]; };
const shape = text => { const r = one(text); return [r.min, r.max, r.currency, r.unit]; };

test('hourly and day rates in German, English and French wording', () => {
  assert.deepEqual(shape('Tagessatz: 800-900 € remote'), [800, 900, 'EUR', 'day']);
  assert.deepEqual(shape('Stundensatz 95 EUR'), [95, 95, 'EUR', 'hour']);
  assert.deepEqual(shape('day rate of £500–£600 outside IR35'), [500, 600, 'GBP', 'day']);
  assert.deepEqual(shape('€80/h'), [80, 80, 'EUR', 'hour']);
  assert.deepEqual(shape("CHF 1'200 pro Tag"), [1200, 1200, 'CHF', 'day']);
  assert.deepEqual(shape('TJM 600€'), [600, 600, 'EUR', 'day']);
  assert.deepEqual(shape('up to 110 €/Std.'), [110, 110, 'EUR', 'hour']);
  assert.deepEqual(shape('USD 60-80/hr'), [60, 80, 'USD', 'hour']);
  assert.deepEqual(shape('Tagessatz 850'), [850, 850, null, 'day'], 'a rate with no currency keeps currency null');
});

test('salaries are annual figures, kept apart from rates', () => {
  assert.deepEqual(shape('Gehalt: 65.000 € - 80.000 € brutto'), [65000, 80000, 'EUR', 'year']);
  assert.deepEqual(shape('salary 70k EUR'), [70000, 70000, 'EUR', 'year']);
  assert.deepEqual(shape('90.000€ p.a.'), [90000, 90000, 'EUR', 'year']);
  const bare = one('$120k - $150k');
  assert.equal(bare.unit, 'year');
  assert.equal(bare.inferredUnit, true, 'a unit read off the size of the number is marked as inferred');
  const mixed = parseRates('Salary 90.000 € p.a. or as a freelancer at 95 €/h');
  assert.equal(pickSalary(mixed).unit, 'year');
  assert.equal(pickGigRate(mixed).unit, 'hour');
});

test('money that is not pay is not a rate', () => {
  assert.deepEqual(parseRates('We raised $20M in Series A'), []);
  assert.deepEqual(parseRates(''), []);
  assert.deepEqual(parseRates(null), []);
  assert.equal(pickGigRate([]), null);
});

test('day-rate conversion states its assumptions through its options', () => {
  assert.equal(toDayRate({ min: 100, max: 100, unit: 'hour', currency: 'EUR' }).min, 800);
  assert.equal(toDayRate({ min: 100, max: 100, unit: 'hour', currency: 'EUR' }, { hoursPerDay: 6 }).min, 600);
  assert.equal(toDayRate({ min: 88000, max: 88000, unit: 'year', currency: 'EUR' }).min, 400);
  assert.equal(toDayRate(null), null);
  assert.equal(salaryEquivalentDayRate(80000), 520);
  assert.equal(salaryEquivalentDayRate(0), null);
});

test('currency conversion uses only the user\'s own rates', () => {
  assert.equal(convertAmount(500, 'GBP', 'EUR', { GBP: 1.15 }), 575);
  assert.equal(convertAmount(500, 'GBP', 'EUR', {}), null);
  assert.equal(convertAmount(500, 'EUR', 'EUR', {}), 500);
});

test('a rate is compared with target and minimum, and never blocks when neither is set', () => {
  const wanted = { target: 800, minimum: 650, currency: 'EUR' };
  assert.equal(compareRate(pickGigRate(parseRates('Stundensatz 95 EUR')), wanted).verdict, 'between');
  assert.equal(compareRate(pickGigRate(parseRates('Tagessatz 900 €')), wanted).verdict, 'above_target');
  assert.equal(compareRate(pickGigRate(parseRates('Tagessatz 700-850 €')), wanted).verdict, 'meets_target');
  assert.equal(compareRate(pickGigRate(parseRates('£500 per day')), wanted, { fx: { GBP: 1.15 } }).verdict, 'below_minimum');
  assert.equal(compareRate(pickGigRate(parseRates('£500 per day')), wanted).verdict, 'unknown', 'no fx rate, no comparison');
  assert.equal(compareRate(pickGigRate(parseRates('Tagessatz 300 €')), { currency: 'EUR' }).verdict, 'no_floor');
  assert.equal(compareRate(null, wanted).verdict, 'unknown');
});

test('engagement type', () => {
  assert.equal(detectEngagement('Für unseren Kunden suchen wir einen Freelancer. Projektlaufzeit 6 Monate, Tagessatz verhandelbar.').type, 'freelance');
  assert.equal(detectEngagement('Unbefristete Festanstellung, 30 Tage Urlaub, betriebliche Altersvorsorge.').type, 'employment');
  assert.equal(detectEngagement('12-month fixed-term contract with full benefits').type, 'fixed_term');
  assert.equal(detectEngagement('Einsatz im Rahmen der Arbeitnehmerüberlassung').type, 'temp_agency');
  assert.equal(detectEngagement('', { title: 'Senior LLM Engineer (Freelance)' }).type, 'freelance');
});

test('contract length, extension, start and utilisation', () => {
  const de = parseContractTerms('Laufzeit: 6 Monate mit Option auf Verlängerung. Start: ab sofort. Auslastung: 100% remote.');
  assert.deepEqual(de.months, { min: 6, max: 6, openEnded: false });
  assert.equal(de.extension, 'stated');
  assert.equal(de.start, 'ab sofort');
  assert.equal(de.utilisation.percent, 100);
  const en = parseContractTerms('Initial contract of 3-6 months, 3 days per week. Start: ASAP');
  assert.deepEqual([en.months.min, en.months.max, en.utilisation.percent, en.start], [3, 6, 60, 'ASAP']);
  assert.equal(parseContractTerms('Our client is looking for a contractor for 6 months, 40h/week.').months.min, 6);
  assert.equal(parseContractTerms('Duration: 12 months+. No extension possible.').extension, 'none');
  assert.equal(parseContractTerms('We have 12 months of runway.').months, null, 'a number of months without a contract cue is not a length');
});

test('benefits and remote shares are not pay or utilisation', () => {
  assert.equal(pickSalary(parseRates('Wir bieten 50€ Gutschein monatlich und 30 Tage Urlaub.')), null);
  assert.equal(parseContractTerms('Projekt mit 100% Auslastung, 60% Remote.').utilisation.percent, 100);
  assert.equal(parseContractTerms('This is a part-time role.').utilisation.percent, null, 'part-time names no share');
  assert.deepEqual(assessScheinselbstaendigkeit('Fully remote. You will use the client laptop.').mitigations, [], 'remote work alone is not a free choice of hours');
});

test('agency or direct', () => {
  assert.equal(detectIntermediary('Für unseren Kunden aus der Automobilbranche', 'Hays AG').via, 'agency');
  assert.equal(detectIntermediary('Our client, a leading bank, needs a contractor.', 'Acme').via, 'agency');
  assert.equal(detectIntermediary('Direktbeauftragung, keine Agentur.', 'Acme GmbH').via, 'direct');
  assert.equal(detectIntermediary('Build agents with us.', 'Acme GmbH').via, 'unknown');
});

test('payment terms', () => {
  assert.equal(parsePaymentTerms('Zahlungsziel: 30 Tage netto').days, 30);
  const en = parsePaymentTerms('Invoices paid within 14 days, payment monthly');
  assert.deepEqual([en.days, en.rhythm], [14, 'monthly']);
  assert.equal(parsePaymentTerms('No word on money.').days, null);
});

test('Scheinselbstaendigkeit indicators and mitigations', () => {
  const risky = assessScheinselbstaendigkeit('Sie arbeiten als Teil des Teams mit festen Arbeitszeiten, 100% vor Ort beim Kunden. Firmenlaptop wird gestellt. Vollzeit.', { months: 12, utilisationPercent: 100 });
  assert.equal(risky.risk, 'high');
  for (const id of ['integration', 'onsite', 'client_equipment', 'duration']) assert.ok(risky.indicators.some(i => i.id === id), id);
  const safe = assessScheinselbstaendigkeit('Werkvertrag mit klaren Meilensteinen, freie Zeiteinteilung, remote.');
  assert.equal(safe.risk, 'low');
  assert.ok(safe.mitigations.some(m => m.id === 'deliverable'));
  assert.equal(assessScheinselbstaendigkeit('').risk, 'unknown', 'no text, no assessment');
});
