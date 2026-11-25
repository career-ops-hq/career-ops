// tests/eval-report-local-dates.test.mjs — the evaluators date a report with
// the LOCAL calendar day (#3070).
//
// Each of the four evaluators derived one `today` and used it for three things
// that have to agree with each other and with the user's calendar:
//
//   the report FILENAME     {num}-{slug}-{today}.md
//   the report header       **Date:** {today}
//   the tracker TSV row     the date column merge-tracker writes
//
// On the UTC day, an evaluation run on a Sunday evening in the Americas writes
// 042-acme-2026-08-18.md, dated the 18th, into a tracker row dated the 18th,
// while every other date the user sees says the 17th. The filename is the part
// that cannot be corrected afterwards, because reports are addressed by it and
// jds/ captures are matched to it.
//
// PINNED INSTANT, not the wall clock — the discipline
// tests/local-today-gates.test.mjs records: the window where the UTC day and
// the local day disagree exists for only part of the UTC day, so a test that
// reads new Date() passes for most of the day whether the bug is there or not.
//
// batch-evaluate-gemini exports processOffer and is driven with mocks (the same
// surface tests/batch-evaluate.test.mjs uses), so it gets a real behavioural
// check. The other three write their report inline in a CLI body that needs an
// API key, so they get a structural one — stated plainly rather than dressed up
// as behavioural.
//
// Run:  node --test tests/eval-report-local-dates.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 01:30 UTC on the 18th is still the 17th everywhere west of Greenwich.
const INSTANT = '2026-08-18T01:30:00Z';
const UTC_DAY = '2026-08-18';
const NY_DAY = '2026-08-17';

test('the premise: at this instant the UTC day and the New York day differ', () => {
  assert.notEqual(UTC_DAY, NY_DAY);
});

test('batch-evaluate-gemini names and dates a report with the local day', async () => {
  const work = mkdtempSync(join(tmpdir(), 'cops-evaldate-'));
  try {
    const reportsDir = join(work, 'reports');
    const additionsDir = join(work, 'tracker-additions');
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(additionsDir, { recursive: true });
    writeFileSync(join(work, 'applications.md'),
      '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');

    // --import freezes Date before the module loads, then the child drives
    // processOffer with the same mocks tests/batch-evaluate.test.mjs uses.
    const freeze = join(work, 'freeze.mjs');
    writeFileSync(freeze, `
const RealDate = Date;
const FROZEN = new RealDate(${JSON.stringify(INSTANT)});
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) { super(FROZEN.getTime()); } else { super(...a); } }
  static now() { return FROZEN.getTime(); }
};
`);
    const driver = join(work, 'driver.mjs');
    writeFileSync(driver, `
const { processOffer, PATHS } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'batch-evaluate-gemini.mjs')).href)});
PATHS.reports = ${JSON.stringify(reportsDir)};
PATHS.trackerAdditions = ${JSON.stringify(additionsDir)};
const mockBrowser = { newPage: async () => ({
  url: () => 'https://example.com/job', route: async () => {}, goto: async () => {},
  waitForTimeout: async () => {},
  evaluate: async () => 'Valid JD Text of sufficient length (more than 100 characters). '.repeat(5),
  close: async () => {},
}) };
const mockEvaluate = async () => \`
---SCORE_SUMMARY---
COMPANY: Acme Corp
ROLE: Senior Engineer
SCORE: 4.5
ARCHETYPE: Tech Lead
LEGITIMACY: High Confidence
---END_SUMMARY---
\`;
await processOffer(mockBrowser, '- [ ] https://example.com/job | Acme Corp | Senior Engineer', 1, mockEvaluate);
`);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(freeze).href, driver], {
      cwd: work, encoding: 'utf-8', timeout: 90_000,
      env: {
        ...process.env,
        TZ: 'America/New_York',
        CAREER_OPS_REPORTS_DIR: reportsDir,
        CAREER_OPS_TRACKER: join(work, 'applications.md'),
      },
    });
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);

    // reserve-report-num.mjs drops a {num}-RESERVED.md sentinel in the same
    // directory to claim the slot; it is not the report and carries no date.
    const reports = readdirSync(reportsDir)
      .filter((f) => f.endsWith('.md') && !/-RESERVED\.md$/.test(f));
    assert.ok(reports.length > 0, `no report was written:\n${r.stdout}${r.stderr}`.slice(0, 600));

    const name = reports[0];
    assert.ok(name.includes(NY_DAY), `the report FILENAME carries the UTC day: ${name}`);
    assert.ok(!name.includes(UTC_DAY), `the report FILENAME carries the UTC day: ${name}`);

    const body = readFileSync(join(reportsDir, name), 'utf-8');
    assert.match(body, new RegExp(`\\*\\*Date:\\*\\*\\s*${NY_DAY}`), `the report header carries the UTC day:\n${body.slice(0, 300)}`);

    const additions = readdirSync(additionsDir).filter((f) => f.endsWith('.tsv'));
    if (additions.length) {
      const tsv = readFileSync(join(additionsDir, additions[0]), 'utf-8');
      assert.ok(tsv.includes(NY_DAY), `the tracker TSV row carries the UTC day:\n${tsv}`);
      assert.ok(!tsv.includes(UTC_DAY), `the tracker TSV row carries the UTC day:\n${tsv}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('no evaluator derives its report date from the UTC day', () => {
  // Structural, and honest about being so: the other three write their report
  // inline in a CLI body that needs an API key, so there is no seam to drive.
  // It still catches the exact regression — a `today` built from toISOString.
  const offenders = [];
  for (const file of ['gemini-eval.mjs', 'ollama-eval.mjs', 'openai-eval.mjs', 'batch-evaluate-gemini.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const line of src.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;                       // comment
      if (/\bconst\s+today\b/.test(line) && /toISOString\(\)/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `report dates derived from the UTC day:\n${offenders.join('\n')}`);
});

test('and each evaluator actually imports localToday', () => {
  // The other half of the structural pair. Absence of toISOString would also be
  // satisfied by deleting the date entirely; this pins what replaced it.
  for (const file of ['gemini-eval.mjs', 'ollama-eval.mjs', 'openai-eval.mjs', 'batch-evaluate-gemini.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    assert.match(src, /from '\.\/lib\/local-today\.mjs'/, `${file} does not import localToday`);
    assert.match(src, /const\s+today\s*=\s*localToday\(\)/, `${file} does not derive today from localToday()`);
  }
});
