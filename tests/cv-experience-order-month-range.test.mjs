// parseExperienceStart took the month nearest the year as the start month. In
// "Jun - Aug 2022", a role inside one year, that is the END month, so a correctly
// ordered CV could be reported as out of order: a role from Jul 2022 listed above
// a summer role "Jun - Aug 2022" looked older than it, because August > July.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExperienceStart, validateCvExperienceOrder } from '../cv-experience-order.mjs';

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

test('a range that runs past New Year starts in the year before the one it names', () => {
  for (const period of ['Nov - Feb 2023', 'November to February 2023', 'Nov – Feb, 2023', 'Nov&ndash;Feb 2023']) {
    assert.deepEqual(parseExperienceStart(period), { year: 2022, month: 11 }, period);
  }
});

test('a range stays in its year when it ends later in it, or its end is not a month', () => {
  assert.deepEqual(parseExperienceStart('Feb - Nov 2023'), { year: 2023, month: 2 });
  assert.deepEqual(parseExperienceStart('Mar - Mar 2023'), { year: 2023, month: 3 });
  assert.deepEqual(parseExperienceStart('Nov - Present 2023'), { year: 2023, month: 11 });
  assert.deepEqual(parseExperienceStart('Ago - Feb 2023'), { year: 2023, month: null });
});

test('a numeric month reads the way a named one does', () => {
  for (const period of ['09/2024 – 12/2024', '9/2024 - 12/2024', '09.2024 - Present', '2024-09 – 2024-12', '2024/09 - Present', '2024-09-15 - Present', '2024-9 - Present', '2024-9']) {
    assert.deepEqual(parseExperienceStart(period), { year: 2024, month: 9 }, period);
  }
});

test('a number that is not clearly a month stays unread', () => {
  // Day first or month first depends on the country, so neither is guessed at.
  assert.deepEqual(parseExperienceStart('03/04/2024'), { year: 2024, month: null });
  // The number after the year here belongs to the end date, not to the start.
  assert.deepEqual(parseExperienceStart('03/04/2024-05/06/2024'), { year: 2024, month: null });
  assert.deepEqual(parseExperienceStart('09/15/2024-10/20/2024'), { year: 2024, month: null });
  assert.deepEqual(parseExperienceStart('13/2024'), { year: 2024, month: null });
  assert.deepEqual(parseExperienceStart('2022-2024'), { year: 2022, month: null });
  assert.deepEqual(parseExperienceStart('2023-24'), { year: 2023, month: null });
});

test('two roles in one year written with numeric months are ordered by them', () => {
  const cv = (first, second) => `<span class="job-period">${first}</span><span class="job-period">${second}</span>`;
  assert.doesNotThrow(() => validateCvExperienceOrder(cv('09/2024 - Present', '01/2024 - 08/2024')));
  assert.throws(() => validateCvExperienceOrder(cv('01/2024 - 08/2024', '09/2024 - Present')), /reverse-chronological/);
});

test('a named range is ordered by its first month, through the real order check', () => {
  const cv = (first, second) => `<span class="job-period">${first}</span><span class="job-period">${second}</span>`;
  assert.doesNotThrow(() => validateCvExperienceOrder(cv('Jul 2022 - Present', 'Jun - Aug 2022')));
  assert.throws(() => validateCvExperienceOrder(cv('Jun - Aug 2022', 'Jul 2022 - Present')), /reverse-chronological/);
});

test('a comma before the year does not hide the month', () => {
  for (const period of ['Jun - Aug, 2022', 'June to August, 2022', 'June, 2022', 'Jun., 2022 - Present']) {
    assert.deepEqual(parseExperienceStart(period), { year: 2022, month: 6 }, period);
  }
});
