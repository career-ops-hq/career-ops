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

// A bracketed magnitude scales the figure instead of being dropped as a note.
const thousands = parseAmount('80–100 USD (in thousands)');
assert(thousands?.min === 80000 && thousands?.max === 100000, 'bracketed "in thousands" scales the range');
assert(mid('80-100 (thousands)') === 90000 && mid('80-100 USD (in K)') === 90000, 'bracketed thousands / K scale');
assert(mid('80–100 (in thousands USD)') === 90000, 'currency inside the magnitude bracket');
assert(mid('1.2 (millions)') === 1200000, 'bracketed millions scale');
assert(parseAmount('80k (in thousands)') === null, 'two magnitudes fail closed');

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
const labelledOther = reportToObservation(report('USD equivalent: 100k CAD'), '001', '2026-10-28')?.observation;
assert(labelledOther?.parsed?.mid === 100000 && labelledOther?.currency === 'UNKNOWN', 'two different codes -> UNKNOWN, never the label\'s code');
assert(reportToObservation(report('100k CAD - 120k CAD'), '001', '2026-10-28')?.observation?.currency === 'CAD', 'one code repeated is still that code');
assert(reportToObservation(report('RMB 600k'), '001', '2026-10-28')?.observation?.currency === 'CNY', 'RMB reads as CNY');
const rmbSuffix = reportToObservation(report('600k RMB per year'), '001', '2026-10-28')?.observation;
assert(rmbSuffix?.parsed?.mid === 600000 && rmbSuffix?.currency === 'CNY', 'RMB after the amount parses and reads as CNY');
assert(mid('600k RMB') === 600000 && parseAmount('600k rmb')?.mid === 600000, 'RMB suffix stripped, any case');
assert(reportToObservation(report('年薪 60-80 万人民币'), '001', '2026-10-28')?.observation?.currency === 'CNY', '人民币 reads as CNY');
assert(reportToObservation(report('CNY 60-80 万人民币'), '001', '2026-10-28')?.observation?.currency === 'CNY', 'CNY and 人民币 agree');
