// tests/contact-extract-local-day.test.mjs — the date contact-extract writes
// into a saved contact's notes is the LOCAL calendar day.
//
// The saved row's notes read "extracted from pasted reply, <date>; …", and the
// date came from new Date().toISOString(): the UTC day. Every evening west of
// Greenwich (and every morning east of it) a contact saved from today's reply
// was recorded under tomorrow's (or yesterday's) date, in data/contacts.tsv,
// the user's own file. local-today-gates.test.mjs (#3070) moved the other
// user-facing stamps of this kind, such as assessment-log's row date, to
// localToday(); this one was missed.
//
// Two zones 25 hours apart (the technique outcome-archive-local-dates.test.mjs
// documents): no instant puts them on the same calendar day, so a UTC-derived
// date fails one of the two runs at any hour, with no frozen clock.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const EAST = 'Pacific/Kiritimati'; // UTC+14
const WEST = 'Pacific/Midway';     // UTC-11

/** The calendar day in `tz`, independent of the code under test. */
function dayIn(tz, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Save one contact with the CLI in `tz`; return the stamped date and the local day(s) the run spanned. */
function saveIn(tz) {
  const root = mkdtempSync(join(tmpdir(), 'contact-extract-local-day-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(tracker, '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|---|---|---|---|---|---|---|---|\n| 12 | 2026-06-01 | Acme Inc | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n');
    const email = join(root, 'email.txt');
    writeFileSync(email, 'Subject: Acme Inc — Backend Engineer: interview invitation\nFrom: Jane Doe <jane@acme.com>\n\n'
      + 'We would like to invite you to interview for the Backend Engineer role.\n');
    const { CAREER_OPS_DATA_DIR: _d, ...env } = process.env;
    const before = dayIn(tz);
    execFileSync(NODE, [join(ROOT, 'contact-extract.mjs'), '--file', email, '--yes'], {
      cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, TZ: tz, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker },
    });
    const after = dayIn(tz);
    const contacts = readFileSync(join(root, 'data', 'contacts.tsv'), 'utf-8');
    const stamped = contacts.match(/extracted from pasted reply, (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    // A run that straddles local midnight may name either day; a wrong date still fails.
    return { stamped, days: before === after ? [before] : [before, after] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\ncontact-extract — the saved contact is dated with the local day');

ok(`premise: ${EAST} and ${WEST} are on different calendar days`, () => {
  // If these ever agreed, the checks below would pass vacuously.
  assert.notStrictEqual(dayIn(EAST), dayIn(WEST));
});

for (const tz of [EAST, WEST]) {
  ok(`in ${tz} the notes carry the local day`, () => {
    const { stamped, days } = saveIn(tz);
    assert.ok(stamped, 'premise: the contact was saved with a dated note');
    assert.ok(days.includes(stamped), `stamped ${stamped}, the local day is ${days.join(' or ')}`);
  });
}
