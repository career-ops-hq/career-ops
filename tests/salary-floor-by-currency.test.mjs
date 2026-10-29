// tests/salary-floor-by-currency.test.mjs
// salary_filter.min_by_currency: one floor per currency.
//
// The flat `min` + `currency` pair cannot express a search across markets. With
// `currency: INR` every USD-quoted job is rejected by the currency-mismatch rule.
// With `currency` left empty, a USD figure is compared numerically against an INR
// floor and rejected as well. Either way the roles from the other market vanish
// from the scan without a message.
// Run: node test-all.mjs --only salary-floor-by-currency
import { buildSalaryFilter } from '../scan.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary_filter.min_by_currency');

const check = (label, got, expected) => {
  if (got === expected) pass(label);
  else fail(`${label}: expected ${expected}, got ${got}`);
};

// The two flat forms that exist today, to show why a map is needed.
const flatInr = buildSalaryFilter({ min: 3_500_000, currency: 'INR' });
const flatNoCurrency = buildSalaryFilter({ min: 3_500_000 });
const usdJob = { min: 60_000, max: 120_000, currency: 'USD' };
check('flat form with currency INR rejects a well-paid USD job', flatInr(usdJob), false);
check('flat form without currency compares USD to the INR floor', flatNoCurrency(usdJob), false);

const f = buildSalaryFilter({ min_by_currency: { INR: 3_500_000, USD: 60_000 } });

check('INR job entirely below the floor is rejected', f({ min: 1_000_000, max: 1_500_000, currency: 'INR' }), false);
check('INR job whose top touches the floor passes', f({ min: 1_000_000, max: 3_500_000, currency: 'INR' }), true);
check('INR job above the floor passes', f({ min: 2_500_000, max: 4_000_000, currency: 'INR' }), true);
check('USD job above its own floor passes', f(usdJob), true);
check('USD job below its own floor is rejected', f({ min: 20_000, max: 40_000, currency: 'USD' }), false);
check('currency match ignores case and padding', f({ min: 20_000, max: 40_000, currency: ' usd ' }), false);
check('a currency with no configured floor passes', f({ min: 10, max: 20, currency: 'EUR' }), true);
check('a job with no currency passes', f({ min: 10, max: 20 }), true);
check('a job with no salary data passes', f(null), true);
check('a job with no usable amounts passes', f({ currency: 'INR' }), true);
check('a job with only a min uses it as the top', f({ min: 4_000_000, currency: 'INR' }), true);

const lowercaseKey = buildSalaryFilter({ min_by_currency: { usd: 60_000 } });
check('floor keys are case-insensitive', lowercaseKey({ max: 10_000, currency: 'USD' }), false);

const empty = buildSalaryFilter({ min_by_currency: {} });
check('an empty map disables filtering', empty({ min: 1, max: 2, currency: 'INR' }), true);

const origError = console.error;
const warnings = [];
console.error = (...a) => warnings.push(a.join(' '));
const bad = buildSalaryFilter({ min_by_currency: { USD: -5, EUR: 'abc', GBP: 50_000 } });
console.error = origError;
check('invalid entries are skipped with one warning each', warnings.length, 2);
check('a valid entry beside invalid ones still applies', bad({ max: 10_000, currency: 'GBP' }), false);
check('a skipped entry leaves its currency unfiltered', bad({ max: 1, currency: 'USD' }), true);

// Backward compatibility: the flat form behaves exactly as before.
const flat = buildSalaryFilter({ min: 100_000, currency: 'USD' });
check('flat form still rejects a currency mismatch', flat({ min: 150_000, max: 200_000, currency: 'EUR' }), false);
check('flat form still rejects a job below the floor', flat({ min: 20_000, max: 40_000, currency: 'USD' }), false);
check('flat form still passes a job above the floor', flat({ min: 90_000, max: 150_000, currency: 'USD' }), true);
