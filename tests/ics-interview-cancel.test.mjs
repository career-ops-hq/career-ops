import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcs, buildRow } from '../ics-interview.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ics-interview.mjs');

const calendar = (calProps, eventProps) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', ...calProps,
  'BEGIN:VEVENT',
  'UID:prescreen-1-example-co',
  'SUMMARY:Prescreen with Example Co',
  'DTSTART:20261105T190000Z',
  'DTEND:20261105T194500Z',
  ...eventProps,
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

for (const [label, calProps, eventProps] of [
  ['METHOD:CANCEL', ['METHOD:CANCEL'], ['SEQUENCE:1']],
  ['STATUS:CANCELLED', ['METHOD:REQUEST'], ['STATUS:CANCELLED']],
]) {
  test(`a ${label} invite gives no Scheduled row`, () => {
    const { event, warnings } = parseIcs(calendar(calProps, eventProps), { displayZone: 'UTC' });
    assert.equal(event.cancelled, true);
    assert.ok(warnings.some((w) => w.code === 'cancelled'), 'cancelled warning');
    assert.equal(buildRow(event), null);
  });
}

test('a confirmed invite still gives a Scheduled row', () => {
  const { event, warnings } = parseIcs(calendar(['METHOD:REQUEST'], ['STATUS:CONFIRMED']), { displayZone: 'UTC' });
  assert.equal(event.cancelled, false);
  assert.deepEqual(warnings, []);
  assert.match(buildRow(event), /\| Scheduled \|/);
});

test('a METHOD:CANCEL in an earlier calendar does not cancel the next one', () => {
  const earlier = ['BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VTODO', 'SUMMARY:Old task', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
  const { event } = parseIcs(`${earlier}\r\n${calendar([], [])}`, { displayZone: 'UTC' });
  assert.equal(event.cancelled, false);
  assert.match(buildRow(event), /\| Scheduled \|/);
});

test('the CLI prints the cancellation instead of a row to paste', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ics-cancel-'));
  try {
    const file = join(dir, 'cancel.ics');
    writeFileSync(file, calendar(['METHOD:CANCEL'], ['STATUS:CANCELLED']));
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    const json = JSON.parse(execFileSync(process.execPath, [SCRIPT, file, '--tz', 'UTC'], { encoding: 'utf-8', env }));
    assert.equal(json.row, null);
    const summary = execFileSync(process.execPath, [SCRIPT, file, '--tz', 'UTC', '--summary'], { encoding: 'utf-8', env });
    assert.doesNotMatch(summary, /Scheduled/);
    assert.match(summary, /cancelled:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
