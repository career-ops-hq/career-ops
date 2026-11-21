// tests/providers/workday-posted-age-bound.test.mjs — "Posted 30+ Days Ago"
// is a known lower bound on a posting's age, not a missing date (#7514).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workday posted-age lower bound');

const DAY = 86_400_000;

try {
  const { parseWorkdayResponse } = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
  const { buildPostingAgeFilter, buildPostedDateFilter, resolveEffectiveAfter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const entry = { name: 'Example Co', careers_url: 'https://example.wd3.myworkdayjobs.com/careers' };
  const jobs = parseWorkdayResponse({
    jobPostings: [
      { title: 'Role A', externalPath: '/job/Toronto-ON/Role-A_R1', locationsText: 'Toronto, ON', postedOn: 'Posted 2 Days Ago' },
      { title: 'Role C', externalPath: '/job/Toronto-ON/Role-C_R3', locationsText: 'Toronto, ON', postedOn: 'Posted 30+ Days Ago' },
    ],
  }, entry);
  const fresh = jobs.find((j) => j.title === 'Role A');
  const stale = jobs.find((j) => j.title === 'Role C');

  // The date column stays honest: no synthetic now - 30d is written.
  if (stale && stale.postedAt === undefined && stale.minAgeDays === 30) {
    pass('a "Posted 30+ Days Ago" posting carries minAgeDays: 30 and no synthetic postedAt');
  } else {
    fail(`expected { postedAt: undefined, minAgeDays: 30 }, got ${JSON.stringify({ postedAt: stale?.postedAt, minAgeDays: stale?.minAgeDays })}`);
  }
  if (fresh && fresh.minAgeDays === undefined && typeof fresh.postedAt === 'number') {
    pass('an exactly dated posting carries no minAgeDays');
  } else {
    fail(`exact posting: ${JSON.stringify({ postedAt: fresh?.postedAt, minAgeDays: fresh?.minAgeDays })}`);
  }

  // max_posting_age_days
  const NOW = Date.parse('2026-11-20T12:00:00Z');
  const cases = [
    [2, false, 'max_posting_age_days: 2 rejects a 30+ day posting'],
    [29, false, 'max_posting_age_days: 29 rejects a 30+ day posting'],
    [30, true, 'max_posting_age_days: 30 keeps a 30+ day posting (the bound cannot rule it out)'],
    [45, true, 'max_posting_age_days: 45 keeps a 30+ day posting'],
    [undefined, true, 'no max_posting_age_days keeps a 30+ day posting'],
  ];
  for (const [max, expected, label] of cases) {
    const got = buildPostingAgeFilter(max, NOW)(undefined, 30);
    if (got === expected) pass(label); else fail(`${label}: got ${got}`);
  }
  if (buildPostingAgeFilter(2, NOW)(undefined) === true && buildPostingAgeFilter(2, NOW)(undefined, undefined) === true) {
    pass('an undated posting with no lower bound still passes (missing data is not penalized)');
  } else {
    fail('an undated posting with no lower bound was rejected');
  }
  if (buildPostingAgeFilter(2, NOW)(NOW - DAY, 30) === true) {
    pass('a real postedAt wins over minAgeDays');
  } else {
    fail('minAgeDays overrode a real postedAt');
  }

  // --posted-after / --since
  const dateCases = [
    [resolveEffectiveAfter(null, 2, NOW), false, '--since 2 rejects a 30+ day posting'],
    [resolveEffectiveAfter(null, 29, NOW), false, '--since 29 rejects a 30+ day posting'],
    [resolveEffectiveAfter(null, 30, NOW), true, '--since 30 keeps a 30+ day posting'],
    ['2026-10-01', true, '--posted-after older than now - 30d keeps a 30+ day posting'],
    ['2026-11-01', false, '--posted-after newer than now - 30d rejects a 30+ day posting'],
  ];
  for (const [after, expected, label] of dateCases) {
    const got = buildPostedDateFilter(after, null, NOW)(undefined, 30);
    if (got === expected) pass(label); else fail(`${label} (after=${after}): got ${got}`);
  }
  if (buildPostedDateFilter(null, '2026-10-01', NOW)(undefined, 30) === true) {
    pass('--posted-before alone keeps an undated 30+ day posting (the bound says nothing about the upper side)');
  } else {
    fail('--posted-before rejected an undated 30+ day posting');
  }
} catch (e) {
  fail(`workday posted-age bound tests crashed: ${e.message}`);
}
