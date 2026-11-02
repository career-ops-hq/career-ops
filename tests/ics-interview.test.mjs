/**
 * tests/ics-interview.test.mjs — ics-interview.mjs (#5743)
 *
 * Synthetic .ics fixtures only. Run: node test-all.mjs --only ics-interview
 */

import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { parseIcsDate, parseIcs, unfoldLines, parseDurationMinutes, buildRow, dateTimeCell, wallToInstant } from '../ics-interview.mjs';
import { pass, fail } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'ics-interview.mjs');

console.log('\nics-interview.mjs — .ics to active-interviews row');

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label} — expected ${e}, got ${a}`);
}

const ics = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const TOR = 'America/Toronto';

// 0. Calendar-impossible dates are unreadable, not rolled into the next month
eq('date: Feb 30 is unreadable', parseIcsDate('20260230T190000Z'), null);
eq('date: Apr 31 is unreadable', parseIcsDate('20260431'), null);
eq('date: Feb 29 in a non-leap year is unreadable', parseIcsDate('20270229T100000'), null);
eq('date: Feb 29 in a leap year is readable', parseIcsDate('20280229T100000Z')?.kind, 'utc');
eq('date: year 0000 is unreadable, not remapped to 1900', parseIcsDate('00000229T000000Z'), null);
eq('date: year 0099 is unreadable', parseIcsDate('00990115T100000Z'), null);
eq('date: year 1000 is readable', parseIcsDate('10000115T100000Z')?.kind, 'utc');
eq('date: Dec 31 is readable', parseIcsDate('20261231')?.kind, 'date');

// 1. TZID start/end, converted to a display zone
{
  const { event, warnings } = parseIcs(ics(
    'SUMMARY:Prescreen with Example Co',
    'DTSTART;TZID=America/Toronto:20261105T140000',
    'DTEND;TZID=America/Toronto:20261105T144500',
    'ORGANIZER;CN=Jane Doe:mailto:jane@example.com',
    'ATTENDEE;CN="Sam Lee";ROLE=REQ-PARTICIPANT:mailto:sam@example.com',
  ), { displayZone: 'Asia/Tokyo' });
  eq('TZID: no warnings', warnings, []);
  eq('TZID: UTC instant (EST = UTC-5)', event.start.utc, '2026-11-05T19:00:00Z');
  eq('TZID: original TZID kept', event.start.tzid, TOR);
  eq('TZID: duration from DTEND', event.durationMinutes, 45);
  eq('TZID: same instant in display zone', [event.display.start.date, event.display.start.time, event.display.end.time], ['2026-11-06', '04:00', '04:45']);
  eq('TZID: organizer name only', event.organizer, 'Jane Doe');
  eq('TZID: attendee names only', event.attendees, ['Sam Lee']);
}

// 2. UTC Z time, and the same instant as TZID gives the same epoch
{
  const { event } = parseIcs(ics('DTSTART:20261105T190000Z', 'DTEND:20261105T194500Z'), { displayZone: TOR });
  eq('UTC: instant', event.start.utc, '2026-11-05T19:00:00Z');
  eq('UTC: shown in Toronto', event.display.start.time, '14:00');
  eq('UTC: duration', event.durationMinutes, 45);
}

// 3. DST: summer date uses EDT (UTC-4)
eq('DST: July wall time is UTC-4', new Date(wallToInstant({ y: 2026, mo: 7, d: 1, h: 10, mi: 0, s: 0 }, TOR)).toISOString(), '2026-07-01T14:00:00.000Z');

// 4. DURATION instead of DTEND
{
  const { event } = parseIcs(ics('DTSTART:20261105T190000Z', 'DURATION:PT1H30M'), { displayZone: 'UTC' });
  eq('DURATION: minutes', event.durationMinutes, 90);
  eq('DURATION: end derived', event.end.utc, '2026-11-05T20:30:00Z');
  eq('DURATION: parse P1DT2H', parseDurationMinutes('P1DT2H'), 1560);
  eq('DURATION: garbage', parseDurationMinutes('soon'), null);
}

// 5. All-day: reported as a date, never a time
{
  const { event } = parseIcs(ics('SUMMARY:On-site day', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106'), { displayZone: TOR });
  eq('all-day: flag', event.allDay, true);
  eq('all-day: no display time', event.display, null);
  eq('all-day: no minutes', event.durationMinutes, null);
  eq('all-day: date cell', dateTimeCell(event), '2026-11-05 (all-day, no time stated)');
}

// 6. Missing DTEND and DURATION: length not stated, never guessed
{
  const { event, warnings } = parseIcs(ics('DTSTART:20261105T190000Z'), { displayZone: 'UTC' });
  eq('no end: duration null', event.durationMinutes, null);
  eq('no end: warning', warnings.map((w) => w.code), ['no-end']);
  eq('no end: row has no length', buildRow(event).includes(' min'), false);
}

// 7. Unknown TZID: reported, not assumed
{
  const { event, warnings } = parseIcs(ics('DTSTART;TZID=Eastern Standard Time:20261105T140000', 'DTEND;TZID=Eastern Standard Time:20261105T150000'), { displayZone: 'UTC' });
  eq('unknown TZID: warning', warnings.map((w) => w.code), ['unknown-tzid', 'unknown-tzid']);
  eq('unknown TZID: no instant', event.start.utc, null);
  eq('unknown TZID: no display conversion', event.display, null);
  eq('unknown TZID: shown as written', dateTimeCell(event), '2026-11-05 14:00 (unknown TZID Eastern Standard Time)');
}

// 8. Floating time: reported as floating, not converted
{
  const { event, warnings } = parseIcs(ics('DTSTART:20261105T140000', 'DTEND:20261105T150000'), { displayZone: 'UTC' });
  eq('floating: kind', event.start.kind, 'floating');
  eq('floating: warning', warnings.map((w) => w.code), ['floating-time', 'floating-time']);
  eq('floating: duration still computed', event.durationMinutes, 60);
  eq('floating: no instant', event.start.utc, null);
}

// 9. Folded lines (CRLF and LF + tab), escaped text, meeting URL
{
  const folded = ics(
    'SUMMARY:Interview\\, round 1\\; panel',
    'DESCRIPTION:Join here: https://example.zoom.us/j/12345?pwd=abc',
    ' def and bring a laptop.\\nSecond line',
    'LOCATION:Zoom',
    'DTSTART:20261105T190000Z',
    'DTEND:20261105T200000Z',
  );
  const { event } = parseIcs(folded, { displayZone: 'UTC' });
  eq('unfold: join continuation', unfoldLines(['A:1', ' 2', '\t3', 'B:x'].join('\r\n')), ['A:123', 'B:x']);
  eq('unescape: comma and semicolon', event.summary, 'Interview, round 1; panel');
  eq('folded URL rejoined mid-token', event.meetingUrl, 'https://example.zoom.us/j/12345?pwd=abcdef');
}

// 10. LF-only input behaves like CRLF
{
  const { event } = parseIcs(ics('DTSTART:20261105T190000Z', 'DTEND:20261105T194500Z').replace(/\r\n/g, '\n'), { displayZone: 'UTC' });
  eq('LF input: duration', event.durationMinutes, 45);
}

// 11. First VEVENT only, nested VALARM ignored, RRULE ignored with a note
{
  const body = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'SUMMARY:First', 'DTSTART:20261105T190000Z', 'DTEND:20261105T200000Z', 'RRULE:FREQ=WEEKLY',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DESCRIPTION:Reminder text', 'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Second', 'DTSTART:20270101T100000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const { event, warnings } = parseIcs(body, { displayZone: 'UTC' });
  eq('first VEVENT only', event.summary, 'First');
  eq('RRULE ignored with warning', warnings.map((w) => w.code), ['rrule-ignored']);
}

// 12. No VEVENT
{
  const { event, warnings } = parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', {});
  eq('no VEVENT: null event', event, null);
  eq('no VEVENT: warning', warnings.map((w) => w.code), ['no-vevent']);
}

// 13. Row: unreadable fields are em dashes; pipes cannot break the table
{
  const { event } = parseIcs(ics('DTSTART;TZID=America/Toronto:20261105T140000', 'DTEND;TZID=America/Toronto:20261105T144500', 'LOCATION:https://meet.google.com/abc-defg-hij'), { displayZone: TOR });
  const row = buildRow(event);
  eq('row: Date/Time, em dash fields, notes', row, '| — | — | — | 2026-11-05 14:00-14:45 EST | — | Scheduled | 45 min; invite zone America/Toronto; https://meet.google.com/abc-defg-hij |');
  eq('row: 7 cells', row.split(' | ').length, 7);
  eq('row: no event -> null', buildRow(null), null);
}

// 13b. Names only: addresses never emitted; a pipe in TZID cannot add columns
{
  const { event } = parseIcs(ics(
    'DTSTART:20261105T190000Z',
    'ORGANIZER;CN=jane@example.com:mailto:jane@example.com',
    'ATTENDEE;CN="mailto:x@example.com":mailto:x@example.com',
    'ATTENDEE;CN=Sam Lee:mailto:sam@example.com',
  ), { displayZone: 'UTC' });
  eq('names only: address-like organizer CN dropped', event.organizer, null);
  eq('names only: address-like attendee CN dropped', event.attendees, ['Sam Lee']);
  const piped = parseIcs(ics('DTSTART;TZID=A|B:20261105T140000', 'DTEND;TZID=A|B:20261105T150000'), { displayZone: 'UTC' });
  const row = buildRow(piped.event);
  eq('pipe in TZID: row still has 7 cells', row.split(' | ').length, 7);
  eq('pipe in TZID: pipe replaced', row.includes('A/B'), true);
}

// 14. CLI: file, --tz, --summary, missing file, bad flag
{
  const dir = mkdtempSync(join(tmpdir(), 'ics-interview-'));
  try {
    const f = join(dir, 'invite.ics');
    writeFileSync(f, ics('SUMMARY:Chat', 'DTSTART;TZID=America/Toronto:20261105T140000', 'DTEND;TZID=America/Toronto:20261105T144500'));
    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: '' };
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, f, '--tz', 'UTC'], { encoding: 'utf-8', env }));
    eq('cli: JSON display zone', out.displayZone, { zone: 'UTC', source: '--tz' });
    eq('cli: JSON display time', out.event.display.start.time, '19:00');
    const summary = execFileSync(process.execPath, [SCRIPT, f, '--tz', 'UTC', '--summary'], { encoding: 'utf-8', env });
    eq('cli: summary prints the row', summary.includes('| — | — | — | 2026-11-05 19:00-19:45 UTC | — | Scheduled |'), true);

    // --match: suggests the tracker row and fills Company/Role; length comes from the .ics
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 7 | 2026-10-01 | Example Industries | Analyst | 4.2/5 | Applied | x | [7](r.md) | |',
    ].join('\n'));
    const matched = JSON.parse(execFileSync(process.execPath, [SCRIPT, f, '--tz', TOR, '--match', 'Company: Example Industries\nWe would like to invite you to schedule your phone screen.'], { encoding: 'utf-8', env }));
    eq('cli --match: candidate', matched.match.candidates.map((c) => c.appNumber), [7]);
    eq('cli --match: length from .ics', [matched.match.lengthMinutes, matched.match.lengthSource], [45, '.ics']);
    eq('cli --match: row gets Company and Role', matched.row.startsWith('| Example Industries | Analyst | — |'), true);

    const missing = (() => { try { execFileSync(process.execPath, [SCRIPT, join(dir, 'nope.ics')], { encoding: 'utf-8', env, stdio: 'pipe' }); return { status: 0, stderr: '' }; } catch (e) { return { status: e.status, stderr: String(e.stderr) }; } })();
    eq('cli: missing file exits 1', missing.status, 1);
    eq('cli: missing file gives the user-facing message', missing.stderr.includes('ics-interview: cannot read') && missing.stderr.includes('file not found'), true);
    eq('cli: missing file has no stack trace', /\n\s+at |node:internal|Error:/.test(missing.stderr), false);
    const bad = (() => { try { execFileSync(process.execPath, [SCRIPT, f, '--bogus'], { encoding: 'utf-8', env, stdio: 'pipe' }); return { status: 0, stderr: '' }; } catch (e) { return { status: e.status, stderr: String(e.stderr) }; } })();
    eq('cli: unknown flag exits 1', bad.status, 1);
    eq('cli: unknown flag gives the user-facing message', bad.stderr.includes('unrecognized flag(s): --bogus'), true);
    eq('cli: unknown flag has no stack trace', /\n\s+at |node:internal/.test(bad.stderr), false);

    // Profile zone: a non-IANA value (e.g. "PST") is reported, not trusted
    const cfg = join(dir, 'config');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, 'profile.yml'), 'location:\n  timezone: "Pacific Standard Time"\n');
    const viaProfile = JSON.parse(execFileSync(process.execPath, [SCRIPT, f], { encoding: 'utf-8', env }));
    eq('cli: invalid profile zone warns', viaProfile.warnings.map((w) => w.code), ['display-zone-invalid']);
    writeFileSync(join(cfg, 'profile.yml'), 'location:\n  timezone: "Asia/Tokyo"\n');
    const viaGood = JSON.parse(execFileSync(process.execPath, [SCRIPT, f], { encoding: 'utf-8', env }));
    eq('cli: profile zone used', viaGood.event.display.start.time, '04:00');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
