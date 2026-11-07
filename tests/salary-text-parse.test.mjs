// @ts-check
/**
 * tests/salary-text-parse.test.mjs — verbose advertised_comp strings through
 * the shared parser in providers/_salary-text.mjs, and the currency guess
 * salary-gap.mjs makes from the same text.
 * Run: node test-all.mjs --only salary-text-parse
 *      Running the file directly prints the same ✅/❌ lines, but a
 *      discovered suite reports through the shared counters and never
 *      exits — so a direct run returns 0 even when assertions fail.
 */

import { parseAmount, compensationPeriod, isCurrencyCode } from '../providers/_salary-text.mjs';
import { reportToObservation } from '../salary-gap.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary text parsing (labels, suffixes, notes, periods)');

function assert(condition, testName) {
  if (condition) pass(testName);
  else fail(testName);
}

const mid = (s) => parseAmount(s)?.mid;

// Text copied verbatim from a JD around the figure.
assert(mid('Annual Annual Salary Range: $165,000 - $190,000') === 177500, 'leading label before colon stripped');
assert(mid('$204.4K – $352K • Offers Equity') === 278200, 'trailing bullet suffix stripped');
assert(mid('$220,000 - $400,000 USD per year') === 310000, 'cadence phrase after the ISO code stripped');
assert(mid('$220,000 - $400,000 per year USD') === 310000, 'ISO code after the cadence phrase stripped');
assert(mid('$150,000 (note: negotiable)') === 150000, 'colon after the first digit is a note, not a label');
assert(mid('€50,000 – €60,000 (Spain)') === 55000, 'trailing parenthetical scope note stripped');
const labelled = parseAmount('Salary: €35.000 - €45.000');
assert(labelled?.min === 35000 && labelled?.max === 45000, 'label stripped ahead of the separator logic');

// A trailing token is a currency only when it is a real ISO-4217 code.
assert(parseAmount('100k tax') === null, 'non-ISO trailing token is not a currency');
assert(mid('450k SEK') === 450000 && mid('80-90k eur') === 85000, 'real codes still stripped, any case');
assert(isCurrencyCode('usd') && !isCurrencyCode('OTE') && !isCurrencyCode('tax'), 'isCurrencyCode');

// A non-annual period fails closed wherever it sits, even in the text the
// parser cuts away around the figure.
for (const s of [
  'Monthly salary: 5,000 USD',
  '5,000 USD • per month',
  '€4,000 – €5,000 (per month)',
  '500 CAD (per day)',
  '100k (weekly)',
  '$40/hr',
]) {
  assert(parseAmount(s) === null, `non-annual period fails closed: ${s}`);
}
assert(compensationPeriod('200 EUR per day') === 'daily', 'daily period recognised');
assert(compensationPeriod('1,000 USD/week') === 'weekly', 'weekly period recognised');
assert(compensationPeriod('Annual salary: 100k') === 'annual', 'annual label still annual');

// salary-gap.mjs takes the first real code, not the first upper-case word.
const report = (comp) => `## Machine Summary\n\n\`\`\`yaml\ncompany: "Acme"\nrole: "Engineer"\nadvertised_comp: "${comp}"\n\`\`\`\n`;
assert(reportToObservation(report('OTE: 100k USD'), '001', '2026-10-28')?.observation?.currency === 'USD', 'label before the amount is not the currency');
assert(reportToObservation(report('100k per year'), '001', '2026-10-28')?.observation?.currency === 'UNKNOWN', 'no code -> UNKNOWN');
