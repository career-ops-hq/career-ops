import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsDate, wallToInstant, buildRow } from '../ics-interview.mjs';

const observance = (kind, start, from, to, rrule) => [
  `BEGIN:${kind}`, `DTSTART:${start}`, `TZOFFSETFROM:${from}`, `TZOFFSETTO:${to}`, ...(rrule ? [`RRULE:${rrule}`] : []), `END:${kind}`,
];

// The VTIMEZONE blocks Outlook and Exchange write next to a Windows zone name.
const OUTLOOK = {
  'Eastern Standard Time': ['America/New_York', [
    ...observance('STANDARD', '16010101T020000', '-0400', '-0500', 'FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11'),
    ...observance('DAYLIGHT', '16010101T020000', '-0500', '-0400', 'FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3'),
  ]],
  'W. Europe Standard Time': ['Europe/Berlin', [
    ...observance('STANDARD', '16010101T030000', '+0200', '+0100', 'FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10'),
    ...observance('DAYLIGHT', '16010101T020000', '+0100', '+0200', 'FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3'),
  ]],
  'AUS Eastern Standard Time': ['Australia/Sydney', [
    ...observance('STANDARD', '16010101T030000', '+1100', '+1000', 'FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=4'),
    ...observance('DAYLIGHT', '16010101T020000', '+1000', '+1100', 'FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=10'),
  ]],
  'India Standard Time': ['Asia/Kolkata', observance('STANDARD', '16010101T000000', '+0530', '+0530')],
};

const invite = (tzid, vtimezone, start, end = null) => [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', `TZID:${tzid}`, ...vtimezone, 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'SUMMARY:Interview with Example Co',
  `DTSTART;TZID=${tzid}:${start}`,
  ...(end ? [`DTEND;TZID=${tzid}:${end}`] : []),
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const wall = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15);

test('an Outlook Eastern Standard Time invite converts to the display zone', () => {
  const [, vtz] = OUTLOOK['Eastern Standard Time'];
  const { event, warnings } = parseIcs(invite('Eastern Standard Time', vtz, '20261103T140000', '20261103T150000'), { displayZone: 'America/Los_Angeles' });
  assert.deepEqual(warnings, []);
  assert.equal(event.start.utc, '2026-11-03T19:00:00Z');
  assert.equal(event.durationMinutes, 60);
  assert.deepEqual([event.display.start.time, event.display.end.time], ['11:00', '12:00']);
  assert.match(buildRow(event), /\| 2026-11-03 11:00-12:00 PST \|/);
});

for (const [tzid, [iana, vtz]] of Object.entries(OUTLOOK)) {
  test(`${tzid} gives the same instant as ${iana} for every hour of the 2026 transition months`, () => {
    const mismatches = [];
    const hours = [2, 3, 9, 10].flatMap((month) => {
      const out = [];
      for (let ms = Date.UTC(2026, month, 1); ms < Date.UTC(2026, month + 1, 1); ms += 3600000) out.push(ms);
      return out;
    });
    for (const ms of hours) {
      const local = wall(ms);
      const expected = wallToInstant(parseIcsDate(local, { TZID: iana }), iana);
      const got = parseIcs(invite(tzid, vtz, local), { displayZone: 'UTC' }).event.start.utc;
      if (got !== new Date(expected).toISOString().replace('.000Z', 'Z')) mismatches.push(`${local}: ${got}`);
    }
    assert.deepEqual(mismatches.slice(0, 5), []);
  });
}

test('a Windows zone name with no VTIMEZONE stays unconverted', () => {
  const { event, warnings } = parseIcs(invite('Eastern Standard Time', [], '20261103T140000').replace(/BEGIN:VTIMEZONE\r\nTZID:[^\r]*\r\nEND:VTIMEZONE\r\n/, ''), { displayZone: 'UTC' });
  assert.equal(event.start.kind, 'unknown-tzid');
  assert.ok(warnings.some((w) => w.code === 'unknown-tzid'));
});

test('a VTIMEZONE rule this parser cannot read stays unconverted', () => {
  const vtz = [
    ...observance('STANDARD', '16010101T020000', '-0400', '-0500', 'FREQ=YEARLY;BYMONTHDAY=1;BYMONTH=11'),
    ...observance('DAYLIGHT', '16010101T020000', '-0500', '-0400', 'FREQ=YEARLY;BYDAY=2SU;BYMONTH=3'),
  ];
  const { event } = parseIcs(invite('Custom Zone', vtz, '20261103T140000'), { displayZone: 'UTC' });
  assert.equal(event.start.kind, 'unknown-tzid');
  assert.equal(event.start.utc, null);
});
