// tests/providers/_country.test.mjs — direct coverage for the shared ISO
// country-code lookup (providers/_country.mjs). Names come from CLDR via
// Node's ICU and can shift between versions, so assertions compare against
// countryName() of the matching alpha-2 code rather than pinning spellings.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _country ISO lookup');

const { countryName, countryNameFromIso } = await import(pathToFileURL(join(ROOT, 'providers/_country.mjs')).href);

if (countryName('GB') && countryName('gb') === countryName('GB')) pass('countryName() resolves alpha-2 case-insensitively');
else fail(`countryName('GB') = ${JSON.stringify(countryName('GB'))}`);

if (countryName('GBR') === '' && countryName('XX') === '' && countryName(42) === '') {
  pass('countryName() stays alpha-2 only and returns "" for anything else');
} else {
  fail('countryName() should return "" for alpha-3, unassigned and non-string input');
}

const pairs = [['USA', 'US'], ['GBR', 'GB'], ['DEU', 'DE'], ['NAM', 'NA'], ['CZE', 'CZ']];
const mismatched = pairs.filter(([a3, a2]) => !countryName(a2) || countryNameFromIso(a3) !== countryName(a2));
if (!mismatched.length) pass('countryNameFromIso() maps alpha-3 to the same name as its alpha-2 code');
else fail(`countryNameFromIso() alpha-3 mismatches: ${JSON.stringify(mismatched)}`);

if (countryNameFromIso('GB') === countryName('GB') && countryNameFromIso(' gbr ') === countryName('GB')) {
  pass('countryNameFromIso() accepts alpha-2 too, and trims/upper-cases its input');
} else {
  fail(`countryNameFromIso(' gbr ') = ${JSON.stringify(countryNameFromIso(' gbr '))}`);
}

if (countryNameFromIso('XXX') === '' && countryNameFromIso('US1') === '' && countryNameFromIso(null) === '' && countryNameFromIso('') === '') {
  pass('countryNameFromIso() returns "" for unassigned codes and non-codes');
} else {
  fail('countryNameFromIso() should return "" for unassigned/invalid input');
}
