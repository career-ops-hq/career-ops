import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsDate, wallToInstant, buildRow } from '../ics-interview.mjs';

// RFC 5545 section 3.3.5: first occurrence in an overlap, pre-gap offset
// for a nonexistent time. Both hemispheres and a half-hour transition matter.
for (const [zone, wall, utc] of [
  ['Europe/Paris', '20261025T023000', '2026-10-25T00:30:00.000Z'],
  ['Europe/Paris', '20260329T023000', '2026-03-29T01:30:00.000Z'],
  ['America/New_York', '20261101T013000', '2026-11-01T05:30:00.000Z'],
  ['America/New_York', '20260308T023000', '2026-03-08T07:30:00.000Z'],
  ['Australia/Lord_Howe', '20260405T014500', '2026-04-04T14:45:00.000Z'],
  ['Australia/Lord_Howe', '20261004T021500', '2026-10-03T15:45:00.000Z'],
  ['Europe/Paris', '20261025T033000', '2026-10-25T02:30:00.000Z'],
  ['America/New_York', '20260308T033000', '2026-03-08T07:30:00.000Z'],
  ['Asia/Kolkata', '20261025T023000', '2026-10-24T21:00:00.000Z'],
  ['Pacific/Apia', '20111230T120000', '2011-12-30T22:00:00.000Z'],
]) {
  test(`${zone} ${wall} resolves to ${utc}`, () => {
    const date = parseIcsDate(wall, { TZID: zone });
    assert.equal(new Date(wallToInstant(date, zone)).toISOString(), utc);
  });
}

test('a Paris overlap keeps the first start and the actual 120-minute duration in the row', () => {
  const { event } = parseIcs([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Paris:20261025T023000',
    'DTEND;TZID=Europe/Paris:20261025T033000',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'), { displayZone: 'UTC' });
  assert.equal(event.start.utc, '2026-10-25T00:30:00Z');
  assert.equal(event.end.utc, '2026-10-25T02:30:00Z');
  assert.equal(event.display.start.time, '00:30');
  assert.equal(event.durationMinutes, 120);
  assert.match(buildRow(event), /120 min/);
});
