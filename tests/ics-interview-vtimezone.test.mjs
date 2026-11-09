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

test('a daylight rule that ended years ago still covers a later interview', () => {
  const ended = [
    ...observance('STANDARD', '20000101T020000', '-0400', '-0500'),
    ...observance('DAYLIGHT', '20000101T020000', '-0500', '-0400', 'FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3;UNTIL=20200308T020000'),
  ];
  const summer = parseIcs(invite('Example Zone', ended, '20260615T120000'), { displayZone: 'UTC' });
  assert.equal(summer.event.start.utc, '2026-06-15T16:00:00Z');

  const recurringStandard = [
    ...observance('STANDARD', '20000101T020000', '-0400', '-0500', 'FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11'),
    ...observance('DAYLIGHT', '20000101T020000', '-0500', '-0400', 'FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3;UNTIL=20200308T020000'),
  ];
  const afterStandard = parseIcs(invite('Example Zone', recurringStandard, '20260615T120000'), { displayZone: 'UTC' });
  assert.equal(afterStandard.event.start.utc, '2026-06-15T17:00:00Z');
});

test('an offset minute, hour, or second past the limit stays unconverted', () => {
  for (const offset of ['+126000', '+240000', '-005961']) {
    const zone = observance('STANDARD', '16010101T000000', offset, offset);
    const { event } = parseIcs(invite('Example Zone', zone, '20260115T120000'), { displayZone: 'UTC' });
    assert.equal(event.start.kind, 'unknown-tzid', offset);
    assert.equal(event.start.utc, null, offset);
  }

  const mixed = [
    ...observance('STANDARD', '16010101T020000', '-0400', '-0500'),
    ...observance('DAYLIGHT', '16010101T020000', '-0500', '+126000'),
  ];
  const broken = parseIcs(invite('Example Zone', mixed, '20260701T140000'), { displayZone: 'UTC' });
  assert.equal(broken.event.start.kind, 'unknown-tzid');
  assert.equal(broken.event.start.utc, null);
});

test('a VTIMEZONE offset keeps its seconds', () => {
  const ahead = observance('STANDARD', '16010101T000000', '+053045', '+053045');
  const plus = parseIcs(invite('Example Zone', ahead, '20260115T120000'), { displayZone: 'UTC' });
  assert.equal(plus.event.start.utc, '2026-01-15T06:29:15Z');

  const behind = observance('STANDARD', '16010101T000000', '-053045', '-053045');
  const minus = parseIcs(invite('Example Zone', behind, '20260115T120000'), { displayZone: 'UTC' });
  assert.equal(minus.event.start.utc, '2026-01-15T17:30:45Z');
});

test('a VTIMEZONE that lists transitions with RDATE stays unconverted', () => {
  const listed = [
    'BEGIN:DAYLIGHT', 'DTSTART:19700101T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400',
    'RDATE:20260308T020000', 'RDATE:20270314T020000', 'END:DAYLIGHT',
  ];
  const onlyRdate = parseIcs(invite('Custom Zone', listed, '20260701T140000'), { displayZone: 'UTC' });
  assert.equal(onlyRdate.event.start.kind, 'unknown-tzid');
  assert.equal(onlyRdate.event.start.utc, null);

  const withRule = [
    ...observance('STANDARD', '16010101T020000', '-0400', '-0500', 'FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11'),
    'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400',
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3', 'RDATE:20260308T020000', 'END:DAYLIGHT',
  ];
  const mixed = parseIcs(invite('Eastern Standard Time', withRule, '20260701T140000'), { displayZone: 'UTC' });
  assert.equal(mixed.event.start.kind, 'unknown-tzid');
  assert.equal(mixed.event.start.utc, null);
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
