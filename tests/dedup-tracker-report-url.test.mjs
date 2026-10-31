// tests/dedup-tracker-report-url.test.mjs — on a tracker with no URL column,
// dedup-tracker must tell two openings apart by their reports' URLs.
//
// The default onboarding tracker has nine columns and no URL cell. Two rows for
// the same company and title can still be two different openings — their
// reports say so in a `**URL:**` header (…/jobs/1001 vs …/jobs/2002).
// merge-tracker.mjs already read that header when a row had no URL cell, and
// keeps both. dedup-tracker.mjs read only the cell, saw no difference, and
// deleted one: the second tool undid the first tool's correct decision, on the
// layout every new user starts with.
//
// Both now read through reportUrlToken() in tracker-utils.mjs, with the same
// path containment, so the two tools agree by construction.

import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { containedReportTarget } from '../tracker-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const row = (n, score, report) =>
  `| ${n} | 2026-10-01 | Acme | Backend Engineer | ${score} | Evaluated | ❌ | ${report} |  |`;
const reportDoc = (url) => `# Acme — Backend Engineer\n\n**Score:** 4.0/5 | **URL:** ${url} | **Legitimacy:** High\n`;

/**
 * Run dedup-tracker on a real data-root layout and return the surviving row
 * numbers. The data root is a child of the temp dir, so a fixture can place a
 * file just OUTSIDE it (`outside`) and the whole tree is still removed.
 */
function survivors(rows, reports, outside) {
  const base = mkdtempSync(join(tmpdir(), 'dedup-report-url-'));
  const root = join(base, 'root');
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'reports'), { recursive: true });
    for (const [name, url] of Object.entries(reports)) writeFileSync(join(root, 'reports', name), reportDoc(url));
    if (outside) writeFileSync(join(base, 'outside.md'), reportDoc(outside));
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    execFileSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '' },
    });
    return readFileSync(tracker, 'utf-8').split('\n')
      .map((l) => l.match(/^\|\s*(\d+)\s*\|/)).filter(Boolean).map((m) => Number(m[1]));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

console.log('\ndedup-tracker — a row with no URL cell is identified by its report');

ok('two openings named only in their reports are both kept', () => {
  // THE BUG. Same company, same title, no URL column — and two different
  // Greenhouse openings according to the reports. merge-tracker keeps both;
  // dedup-tracker used to delete #51.
  const kept = survivors(
    [row(50, '4.2/5', '[50](../reports/050-acme.md)'), row(51, '3.8/5', '[51](../reports/051-acme.md)')],
    { '050-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001',
      '051-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/2002' },
  );
  assert.deepStrictEqual(kept, [50, 51], `expected both openings kept, got ${JSON.stringify(kept)}`);
});

ok('two rows whose reports name the SAME posting are still deduplicated', () => {
  // The other half: the fallback must add evidence of distinctness, never stop
  // dedup working. Same URL in both reports is one posting evaluated twice.
  const kept = survivors(
    [row(50, '4.2/5', '[50](../reports/050-acme.md)'), row(51, '3.8/5', '[51](../reports/051-acme.md)')],
    { '050-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001',
      '051-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001' },
  );
  assert.strictEqual(kept.length, 1, `one posting must collapse to one row, got ${JSON.stringify(kept)}`);
});

ok('a language param on one report only blocks the title match, as merge-tracker does', () => {
  // The second guard that reads a posting URL. The same page with `?lang=de` on
  // one side only is not proof of two postings, but the bare URL does not say
  // which language it serves, so a title match must not fold the German row
  // into the English one. With no URL cell that is only knowable from the
  // reports.
  const kept = survivors(
    [row(50, '4.2/5', '[50](../reports/050-acme.md)'), row(51, '3.8/5', '[51](../reports/051-acme.md)')],
    { '050-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001',
      '051-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001?lang=de' },
  );
  assert.deepStrictEqual(kept, [50, 51], `expected both language versions kept, got ${JSON.stringify(kept)}`);
});

ok('a Report cell that walks out of the data root is not read', () => {
  // Containment. The tracker is user-editable, so a Report cell is untrusted.
  // `reports/../../outside.md` escapes the root through an EMBEDDED `..`, which
  // stripping leading `../` does not catch. The file it reaches names a
  // different posting, so if it were read the rows would look distinct and
  // both survive. Refused, #51 has no URL and the pair dedups exactly as it
  // would with no report at all.
  const kept = survivors(
    [row(50, '4.2/5', '[50](../reports/050-acme.md)'), row(51, '3.8/5', '[51](reports/../../outside.md)')],
    { '050-acme.md': 'https://job-boards.greenhouse.io/acme/jobs/1001' },
    'https://job-boards.greenhouse.io/acme/jobs/9999',
  );
  assert.strictEqual(kept.length, 1, `a report outside the root must not be read, got ${JSON.stringify(kept)}`);
});

ok('containedReportTarget refuses a path that escapes the root', () => {
  const root = resolve(sep, 'srv', 'career-ops');
  assert.strictEqual(containedReportTarget('[1](../../../etc/passwd)', root), join(root, 'etc', 'passwd'),
    'leading ../ is stripped and the rest resolved INSIDE the root');
  assert.strictEqual(containedReportTarget('[1](reports/../../../etc/passwd)', root), null,
    'an embedded ../ that walks out of the root is refused');
  assert.strictEqual(containedReportTarget('—', root), null, 'no link, no path');
});
