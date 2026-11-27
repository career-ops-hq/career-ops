import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from '../ics-interview.mjs';

const observance = (kind, from, to, rrule) => [
  `BEGIN:${kind}`, 'DTSTART:16010101T020000', `TZOFFSETFROM:${from}`, `TZOFFSETTO:${to}`, `RRULE:${rrule}`, `END:${kind}`,
];

const invite = (until, start) => [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:Eastern Standard Time',
  ...observance('STANDARD', '-0400', '-0500', 'FREQ=YEARLY;BYDAY=1SU;BYMONTH=11'),
  ...observance('DAYLIGHT', '-0500', '-0400', `FREQ=YEARLY;BYDAY=2SU;BYMONTH=3;UNTIL=${until}`),
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'SUMMARY:Interview with Example Co', `DTSTART;TZID=Eastern Standard Time:${start}`, 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

test('a DATE-valued UNTIL includes its last day: a 14:00 invite that day is EDT', () => {
  // 2020-03-08 is the last DAYLIGHT onset; UNTIL is inclusive, so that whole
  // day is daylight time (-0400) and 14:00 local is 18:00Z.
  const { event } = parseIcs(invite('20200308', '20200308T140000'), { displayZone: 'UTC' });
  assert.equal(event.start.utc, '2020-03-08T18:00:00Z');
});

test('a DATE-valued UNTIL behaves like the equivalent DATE-TIME UNTIL on later days', () => {
  for (const day of ['20200308', '20200309', '20200615', '20261105']) {
    const start = `${day}T140000`;
    const expected = parseIcs(invite('20200308T020000', start), { displayZone: 'UTC' }).event.start.utc;
    const got = parseIcs(invite('20200308', start), { displayZone: 'UTC' }).event.start.utc;
    assert.equal(got, expected, day);
  }
});
