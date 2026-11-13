// tests/output-names.test.mjs — the artifact filename standard (#6667).
//
//   {NNN}-{company-slug}-{kind}-{candidate-slug}-{YYYY-MM-DD}[-{variant}].{ext}
//
// Covers lib/output-names.mjs and the default name generate-cover-letter.mjs
// gives a letter when it has a report number and no explicit path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildOutputName, parseOutputName, slugFromReport, kebab, padReportNum } from '../lib/output-names.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAPTURE_REGISTER = fileURLToPath(new URL('./fixtures/cover-pdf-capture-register.mjs', import.meta.url));
const DATE = '2026-11-07';

test('buildOutputName: the documented example', () => {
  assert.equal(
    buildOutputName({ report: 24, company: 'zep', kind: 'cv', candidate: 'David Gitman', date: DATE }),
    '024-zep-cv-david-gitman-2026-11-07.pdf',
  );
});

test('buildOutputName: variant and extension', () => {
  assert.equal(
    buildOutputName({ report: '7', company: 'acme-co', kind: 'cover', candidate: 'avery-quinn', date: DATE, variant: 'ats', ext: 'html' }),
    '007-acme-co-cover-avery-quinn-2026-11-07-ats.html',
  );
});

test('buildOutputName: sorts by report number first', () => {
  const names = [
    buildOutputName({ report: 100, company: 'a', kind: 'cv', candidate: 'x', date: DATE }),
    buildOutputName({ report: 9, company: 'z', kind: 'cv', candidate: 'x', date: DATE }),
    buildOutputName({ report: 24, company: 'm', kind: 'cover', candidate: 'x', date: DATE }),
  ];
  assert.deepEqual([...names].sort().map((n) => n.slice(0, 3)), ['009', '024', '100']);
});

test('buildOutputName: slugs are ASCII kebab-case', () => {
  assert.equal(kebab('Zoë  Café & Co.'), 'zoe-cafe-co');
  assert.equal(
    buildOutputName({ report: 1, company: 'Zoë Café', kind: 'cv', candidate: "Ana O'Brien", date: DATE }),
    '001-zoe-cafe-cv-ana-o-brien-2026-11-07.pdf',
  );
});

test('buildOutputName: rejects bad input instead of guessing', () => {
  const ok = { report: 1, company: 'a', kind: 'cv', candidate: 'b', date: DATE };
  assert.throws(() => buildOutputName({ ...ok, kind: 'resume' }), /kind/);
  assert.throws(() => buildOutputName({ ...ok, variant: 'fancy' }), /variant/);
  assert.throws(() => buildOutputName({ ...ok, date: '11/07/2026' }), /date/);
  assert.throws(() => buildOutputName({ ...ok, company: '---' }), /company/);
  assert.throws(() => buildOutputName({ ...ok, candidate: '' }), /candidate/);
  assert.throws(() => buildOutputName({ ...ok, report: 'abc' }), /report/);
  assert.throws(() => buildOutputName({ ...ok, report: 0 }), /report/);
  assert.throws(() => buildOutputName({ ...ok, ext: 'p/df' }), /extension/);
});

test('padReportNum: pads, keeps wider numbers', () => {
  assert.equal(padReportNum('5'), '005');
  assert.equal(padReportNum(1234), '1234');
});

test('parseOutputName: round-trips what buildOutputName writes', () => {
  const cases = [
    { report: 24, company: 'zep', kind: 'cv', candidate: 'David Gitman', date: DATE },
    { report: 7, company: 'acme-co', kind: 'cover', candidate: 'Avery Quinn', date: DATE, variant: 'canva' },
    { report: 312, company: 'big-corp-eu', kind: 'cv', candidate: 'Zoë Café', date: DATE, ext: 'html' },
  ];
  for (const c of cases) {
    const name = buildOutputName(c);
    const parsed = parseOutputName(name);
    assert.ok(parsed, name);
    assert.equal(parsed.report, padReportNum(c.report));
    assert.equal(parsed.company, kebab(c.company));
    assert.equal(parsed.kind, c.kind);
    assert.equal(parsed.candidate, kebab(c.candidate));
    assert.equal(parsed.date, c.date);
    assert.equal(parsed.variant, c.variant ?? null);
    assert.equal(parsed.ext, c.ext ?? 'pdf');
  }
});

test('parseOutputName: legacy and malformed names are not standard', () => {
  for (const name of [
    'cv-david-gitman-zep-2026-11-07.pdf',      // old company-last order
    'zep-engineer-cover.pdf',                  // legacy cover default
    '024-zep-2026-11-07.pdf',                  // no kind
    '024-zep-cv-david-gitman.pdf',             // no date
    '024-zep-cv-david-gitman-2026-11-07-fancy.pdf', // unknown variant
    '024-zep-cv-cover-david-2026-11-07.pdf',   // two kind tokens: ambiguous
    '24-zep-cv-david-gitman-2026-11-07.pdf',   // report not padded
    'notes.txt',
  ]) {
    assert.equal(parseOutputName(name), null, name);
  }
});

function withReports(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-output-names-'));
  try {
    mkdirSync(join(dir, 'reports'));
    for (const f of files) writeFileSync(join(dir, 'reports', f), '# r\n');
    return fn(join(dir, 'reports'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('slugFromReport: reads the slug from the report filename', () => {
  withReports(['024-zep-2026-11-07.md', '025-acme-co-2026-11-08.md', '026-note.txt'], (dir) => {
    assert.equal(slugFromReport(24, dir), 'zep');
    assert.equal(slugFromReport('025', dir), 'acme-co');
    assert.equal(slugFromReport(26, dir), null);
    assert.equal(slugFromReport(99, dir), null);
    assert.equal(slugFromReport('x', dir), null);
  });
});

test('slugFromReport: a missing reports directory is null, not a throw', () => {
  assert.equal(slugFromReport(1, join(tmpdir(), 'career-ops-no-such-reports-dir')), null);
});

// --- generate-cover-letter.mjs default name ---------------------------------

function runCover({ flags = [], reports = [], candidate = { name: 'Avery Quinn', email: 'avery.quinn@example.com' }, outputPath } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-name-'));
  try {
    mkdirSync(join(dir, 'output'));
    mkdirSync(join(dir, 'reports'));
    for (const f of reports) writeFileSync(join(dir, 'reports', f), '# r\n');
    writeFileSync(join(dir, 'cv.md'), 'Avery Quinn builds ledger services.\n');
    const payloadPath = join(dir, 'payload.json');
    const capture = join(dir, 'capture.json');
    const payload = {
      candidate,
      letter: { company: 'Acme Co', role_title: 'Engineer', opening: 'Opening line.', profile_intro: 'Profile intro.' },
    };
    if (outputPath) payload.output_path = outputPath;
    writeFileSync(payloadPath, JSON.stringify(payload));
    const res = spawnSync(process.execPath, [
      '--import', pathToFileURL(CAPTURE_REGISTER).href,
      join(ROOT, 'generate-cover-letter.mjs'),
      '--payload', payloadPath,
      ...flags,
    ], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', COVER_PDF_CAPTURE: capture },
    });
    const captured = existsSync(capture) ? JSON.parse(readFileSync(capture, 'utf-8')) : null;
    return { ...res, name: captured ? basename(captured.outputPath) : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TODAY = /\d{4}-\d{2}-\d{2}/;

test('cover default name: --report with a report file gives the standard name', () => {
  const res = runCover({ flags: ['--report=24'], reports: ['024-acme-co-2026-11-07.md'] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const parsed = parseOutputName(res.name);
  assert.ok(parsed, res.name);
  assert.equal(parsed.report, '024');
  assert.equal(parsed.company, 'acme-co');
  assert.equal(parsed.kind, 'cover');
  assert.equal(parsed.candidate, 'avery-quinn');
  assert.match(parsed.date, TODAY);
  assert.equal(parsed.variant, null);
  assert.equal(parsed.ext, 'pdf');
});

test('cover default name: an unpadded --report finds the padded report file', () => {
  const res = runCover({ flags: ['--report=7'], reports: ['007-acme-co-2026-11-07.md'] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(parseOutputName(res.name)?.report, '007');
});

test('cover default name: no --report keeps the legacy name', () => {
  const res = runCover({ reports: ['024-acme-co-2026-11-07.md'] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.name, 'acme-co-engineer-cover.pdf');
});

test('cover default name: --report with no matching report file keeps the legacy name', () => {
  const res = runCover({ flags: ['--report=24'] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.name, 'acme-co-engineer-cover.pdf');
});

test('cover default name: an explicit output_path still wins (#2940)', () => {
  const res = runCover({ flags: ['--report=24'], reports: ['024-acme-co-2026-11-07.md'], outputPath: 'output/mine.pdf' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.name, 'mine.pdf');
});

test('cover default name: --out still wins', () => {
  const res = runCover({ flags: ['--report=24', '--out', 'output/chosen.pdf'], reports: ['024-acme-co-2026-11-07.md'] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(res.name, 'chosen.pdf');
});
