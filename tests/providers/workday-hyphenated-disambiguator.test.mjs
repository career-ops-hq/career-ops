import { pass, fail, finish, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workday hyphenated disambiguator');

try {
  const { workdayDedupKey } = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);

  const wd = (tail, site = 'careers') =>
    workdayDedupKey({ url: `https://acme.wd5.myworkdayjobs.com/${site}/job/City/Some-Role_${tail}` });
  const keyOf = (tail) => `workday:acme.wd5.myworkdayjobs.com:${tail.toLowerCase()}`;

  const hyphenatedBase = wd('JR26-39350');
  const hyphenatedCopy = wd('JR26-39350-2', 'indeed');
  if (hyphenatedBase === keyOf('JR26-39350') && hyphenatedCopy === hyphenatedBase) {
    pass('workdayDedupKey() collapses a hyphenated requisition base plus trailing `-N` to the unsuffixed base');
  } else {
    fail(`workdayDedupKey() did not collapse a hyphenated requisition base: ${JSON.stringify({ hyphenatedBase, hyphenatedCopy })}`);
  }

  if (wd('R-2593225') && wd('R-2592964') && wd('R-2593225') !== wd('R-2592964')) {
    pass('workdayDedupKey() still keeps distinct R-NNNNNNN requisitions apart');
  } else {
    fail(`workdayDedupKey() regressed the R-NNNNNNN guard: ${wd('R-2593225')} vs ${wd('R-2592964')}`);
  }

  const existingFixtures = new Map([
    ['R11312', keyOf('R11312')],
    ['R11312-2', keyOf('R11312')],
    ['R11312-3', keyOf('R11312')],
    ['R260022205-2', keyOf('R260022205')],
    ['R26007842-1', keyOf('R26007842')],
    ['R266069-1', keyOf('R266069')],
    ['R53113-2', keyOf('R53113')],
    ['JR1126610-1', keyOf('JR1126610')],
    ['R2000678390-1', keyOf('R2000678390')],
    ['R26_05710-1', keyOf('R26_05710')],
    ['R-058589', keyOf('R-058589')],
    ['R-101976', keyOf('R-101976')],
    ['R-4253', keyOf('R-4253')],
    ['R-103502', keyOf('R-103502')],
    ['R2026-00707', keyOf('R2026-00707')],
    ['R2026-01237', keyOf('R2026-01237')],
    ['R2026-01334', keyOf('R2026-01334')],
    ['R2026-01355', keyOf('R2026-01355')],
  ]);
  const drifted = [...existingFixtures].filter(([tail, expected]) => wd(tail) !== expected);
  if (drifted.length === 0) {
    pass('workdayDedupKey() keeps the existing fixture keys unchanged');
  } else {
    fail(`workdayDedupKey() changed existing fixture keys: ${JSON.stringify(drifted.map(([tail, expected]) => ({ tail, actual: wd(tail), expected })) )}`);
  }
} catch (err) {
  fail(`workday hyphenated disambiguator test crashed: ${err.stack || err.message}`);
} finally {
  finish();
}
