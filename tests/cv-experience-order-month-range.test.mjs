// parseExperienceStart took the month nearest the year as the start month. In
// "Jun - Aug 2022", a role inside one year, that is the END month, so a correctly
// ordered CV could be reported as out of order: a role from Jul 2022 listed above
// a summer role "Jun - Aug 2022" looked older than it, because August > July.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExperienceStart } from '../cv-experience-order.mjs';

test('a month range inside one year starts in its first month', () => {
  for (const period of ['Jun - Aug 2022', 'Jun – Aug 2022', 'Jun — Aug 2022', 'June to August 2022', 'Jun-Aug 2022']) {
    assert.deepEqual(parseExperienceStart(period), { year: 2022, month: 6 }, period);
  }
});

test('an encoded dash still separates the range, as rendered HTML writes it', () => {
  for (const dash of ['&ndash;', '&mdash;', '&#8211;', '&#8212;', '&#x2013;', '&#x2014;', '&NDASH;']) {
    const period = `Jun ${dash} Aug 2022`;
    assert.deepEqual(parseExperienceStart(period), { year: 2022, month: 6 }, period);
  }
  assert.deepEqual(parseExperienceStart('Aug&nbsp;2022 &ndash; Present'), { year: 2022, month: 8 });
});

test('a single month still reads as before', () => {
  assert.deepEqual(parseExperienceStart('Aug 2022 - Present'), { year: 2022, month: 8 });
  assert.deepEqual(parseExperienceStart('Since Mar 2021'), { year: 2021, month: 3 });
  assert.deepEqual(parseExperienceStart('Jan 2020 - Jun 2021'), { year: 2020, month: 1 });
  assert.deepEqual(parseExperienceStart('2019 - 2021'), { year: 2019, month: null });
});
