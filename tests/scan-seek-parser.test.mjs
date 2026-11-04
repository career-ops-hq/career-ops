// tests/scan-seek-parser.test.mjs — parser unit tests over a fixture HTML.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

console.log('\nParser — scan-seek (nz.seek.com SEO page extractor)');

try {
  const seekModule = await import(pathToFileURL(join(ROOT, 'scan-seek.mjs')).href);
  const { extractRedux, findJobArray, normalizeJob, slugifyQuery, fetchQuery } = seekModule;

  const fixtureHtml = readFileSync(join(ROOT, 'tests/fixtures/seek-search-page.html'), 'utf8');

  // extractRedux
  const redux = extractRedux(fixtureHtml);
  if (redux && redux.jobs) pass('extractRedux finds the inlined JSON blob');
  else fail('extractRedux returned ' + JSON.stringify(redux));

  // findJobArray
  const arr = findJobArray(redux);
  if (Array.isArray(arr) && arr.length === 3) pass('findJobArray locates the 3-job array');
  else fail('findJobArray returned ' + JSON.stringify(arr?.map((j) => j.id)));

  // normalizeJob — first job
  const j1 = normalizeJob(arr[0]);
  if (j1.id === '12345') pass('normalizeJob preserves id');
  else fail('id: ' + j1.id);
  if (j1.title === 'Senior Software Engineer') pass('normalizeJob extracts title');
  else fail('title: ' + j1.title);
  if (j1.company === 'Xero') pass('normalizeJob extracts company');
  else fail('company: ' + j1.company);
  if (j1.location === 'Auckland, Auckland, Auckland') pass('normalizeJob joins location parts');
  else fail('location: ' + j1.location);
  if (j1.url === 'https://nz.seek.com/job/12345') pass('normalizeJob builds job URL');
  else fail('url: ' + j1.url);
  if (j1.listedAt === '2026-10-15') pass('normalizeJob slices listedAt to date');
  else fail('listedAt: ' + j1.listedAt);
  if (j1.workTypes === 'Full-time') pass('normalizeJob joins workTypes');
  else fail('workTypes: ' + j1.workTypes);

  // normalizeJob — second job (remote flag)
  const j2 = normalizeJob(arr[1]);
  if (j2.workTypes === 'Full-time/Remote') pass('normalizeJob handles multiple workTypes');
  else fail('workTypes: ' + j2.workTypes);

  // slugifyQuery
  if (slugifyQuery('Site Reliability Engineer') === 'site-reliability-engineer') pass('slugifyQuery basic');
  else fail('slugifyQuery basic: ' + slugifyQuery('Site Reliability Engineer'));
  if (slugifyQuery('Platform Engineer') === 'platform-engineer') pass('slugifyQuery no -jobs suffix');
  else fail('slugifyQuery no -jobs: ' + slugifyQuery('Platform Engineer'));
  if (slugifyQuery('DevOps Engineer-jobs') === 'devops-engineer-jobs') pass('slugifyQuery preserves existing -jobs');
  else fail('slugifyQuery -jobs: ' + slugifyQuery('DevOps Engineer-jobs'));

  console.log('\n✅ All scan-seek parser tests passed');
} catch (e) {
  console.error('❌ scan-seek parser test crashed:', e);
  process.exit(1);
}