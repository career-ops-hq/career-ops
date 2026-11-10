// tests/salary-text-nordic.test.mjs — parseAmount reads Norwegian salary
// spellings (#6620).
//
// Norwegian postings write "kr 1.100.000 – 1.400.000", "NOK 2 000 000" or
// "650 000,-". parseAmount returned null for all three, so salary-gap.mjs
// showed a Norwegian report's advertised pay as "—" and the scanner's salary
// filter could not read it.
import { pass, fail } from './helpers.mjs';
import { parseAmount } from '../providers/_salary-text.mjs';

console.log('\n_salary-text — Norwegian salary spellings');

function expect(raw, expected) {
  const got = parseAmount(raw);
  const same = expected === null
    ? got === null
    : got !== null && got.min === expected.min && got.max === expected.max;
  same
    ? pass(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`)
    : fail(`${JSON.stringify(raw)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

expect('kr 1.100.000 – 1.400.000', { min: 1100000, max: 1400000 });
expect('NOK 2 000 000-2 600 000', { min: 2000000, max: 2600000 });
expect('1 100 000 - 1 400 000 kr', { min: 1100000, max: 1400000 });
expect('650 000 kr', { min: 650000, max: 650000 });
expect('kr 650 000,-', { min: 650000, max: 650000 });
expect('kr. 900 000', { min: 900000, max: 900000 });
expect('NOK 1500000', { min: 1500000, max: 1500000 });
expect('1 250 000 kr', { min: 1250000, max: 1250000 });

// Existing spellings keep their meaning.
expect('2000k-2600k NOK', { min: 2000000, max: 2600000 });
expect('80 - 90k', { min: 80000, max: 90000 });
expect('$123,684—$254,644 USD', { min: 123684, max: 254644 });
expect('45.000,00 EUR', { min: 45000, max: 45000 });
expect('82.5k', { min: 82500, max: 82500 });

// Prose around the figure is still not a salary.
expect('Lønn fra kr 1.100.000 – 1.400.000 som avdelingsdirektør i stillingskode 1060', null);
expect('konkurransedyktig', null);
