// tests/scan-ats-full-workday-junk-tenant.test.mjs — the public
// workday_companies.json dataset has a data-quality defect (career-ops-hq/career-ops#4454,
// Feashliaa/job-board-aggregator#42): ~47% of its entries carry an
// instance-name lookalike (wd1, wd5, wd12, ...) in the tenant slot instead of
// a real company. toEntry() drops those before a request is ever made.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — workday junk-tenant filter');

const { SOURCES } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

// A junk-shaped tenant (instance-name lookalike) is dropped outright.
{
  const junkTenants = ['wd1', 'wd5', 'wd12', 'wd102', 'wd501', 'WD5'];
  const results = junkTenants.map((tenant) => SOURCES.workday.toEntry(`${tenant}|wd1|somecareers`));
  if (results.every((e) => e === null)) pass('a wdN-shaped tenant is dropped, case-insensitively');
  else fail(`junk tenant not dropped: ${JSON.stringify(results)}`);
}

// A real company whose name merely contains "wd" + digits as a substring, or
// which is prefixed/suffixed rather than an exact wdN match, is not affected.
{
  const realish = ['wd1corp', 'awd12', 'wd1-services', 'woodruffcenter', 'tempus'];
  const results = realish.map((tenant) => SOURCES.workday.toEntry(`${tenant}|wd1|somecareers`));
  if (results.every((e) => e !== null)) pass('a tenant that only resembles wdN (substring, not an exact match) is kept');
  else fail(`real-ish tenant wrongly dropped: ${JSON.stringify(results.map((e, i) => [realish[i], e]))}`);
}

// The filter runs before the generic slug check, not instead of it — hostile
// input is still rejected.
{
  if (SOURCES.workday.toEntry('evil/..%2f|wd1|site') === null) pass('toEntry still rejects non-slug tenant input');
  else fail('toEntry accepted a hostile tenant slug');
}

// A real entry is unaffected end to end.
{
  const e = SOURCES.workday.toEntry('acme|wd5|careers');
  if (e?.careers_url === 'https://acme.wd5.myworkdayjobs.com/careers') pass('a real tenant still resolves normally');
  else fail(`real tenant: ${JSON.stringify(e)}`);
}
