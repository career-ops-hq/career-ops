// The CV copy for manual uploads (LinkedIn Easy Apply, email): the name an
// employer sees, built by the same lib/upload-name.mjs the web apply flow uses
// (#6399), written next to the canonical PDF and never indexed.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './helpers.mjs';
import { cvUploadName, shortRole } from '../lib/upload-name.mjs';

const {
  uploadCopyPath, writeUploadCopy, readUploadCopySettings, trackerRoleForReport,
} = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

const NO_WEB = !existsSync(join(ROOT, 'web', 'src')) && 'web/ is not present in this checkout';

const headline = (text) => `<html><body><div class="header-title">${text}</div></body></html>`;

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'upload-copy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the web app carries a byte-identical copy of the name builder', { skip: NO_WEB }, () => {
  assert.equal(readFileSync(join(ROOT, 'web/src/lib/apply/upload-name.mjs'), 'utf8'),
    readFileSync(join(ROOT, 'lib/upload-name.mjs'), 'utf8'));
});

test('a middot or bullet ends the role like any other qualifier', () => {
  assert.equal(shortRole('Analytics Engineer · Data Quality & Observability'), 'Analytics Engineer');
  assert.equal(shortRole('Data Analyst • Remote'), 'Data Analyst');
  assert.equal(cvUploadName({ fullName: 'Jane DOE', role: 'Analytics Engineer · dbt' }), 'Jane-Doe-Analytics-Engineer-CV.pdf');
});

test('the copy sits in upload/{output stem}/ next to the canonical PDF', async () => {
  const out = join('output', 'cv-jane-doe-012-acme-2026-11-19.pdf');
  assert.equal(
    await uploadCopyPath(out, { fullName: 'Jane Doe', role: 'Analytics Engineer, Revenue Data' }),
    join('output', 'upload', 'cv-jane-doe-012-acme-2026-11-19', 'Jane-Doe-Analytics-Engineer-CV.pdf'),
  );
});

test('the role comes from the caller first, the printed headline last', async () => {
  const html = headline('Data Analyst &amp; Analytics Engineer · Data Quality');
  assert.match(await uploadCopyPath('output/cv.pdf', { fullName: 'Jane Doe', role: 'Analytics Engineer', html }), /Jane-Doe-Analytics-Engineer-CV\.pdf$/);
  assert.match(await uploadCopyPath('output/cv.pdf', { fullName: 'Jane Doe', html }), /Jane-Doe-Data-Analyst-Analytics-Engineer-CV\.pdf$/);
  assert.match(await uploadCopyPath('output/cv.pdf', { fullName: 'Jane Doe' }), /[\\/]Jane-Doe-CV\.pdf$/);
});

test('a name over the 64-character portal limit drops the role (#5629)', async () => {
  const role = 'Principal Distinguished Analytics Engineering Platform Reliability Architect';
  const path = await uploadCopyPath('output/cv.pdf', { fullName: 'Maria-Fernanda Gonzalez Rodriguez', role });
  assert.match(path, /[\\/]Maria-Fernanda-Gonzalez-Rodriguez-CV\.pdf$/);
});

test('the tracker row linked to the report supplies the role', (t) => {
  const dir = scratch(t);
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-11-01 | Acme | Data Engineer, Platform | 4.1/5 | Evaluated | ✅ | [011](reports/011-acme-2026-11-01.md) | |',
    '| 2 | 2026-11-02 | Globex | Analytics Engineer | 4.3/5 | Evaluated | ✅ | [012](reports/012-globex-2026-11-02.md) | |',
  ].join('\n'));
  assert.equal(trackerRoleForReport('012', tracker), 'Analytics Engineer');
  assert.equal(trackerRoleForReport('11', tracker), 'Data Engineer, Platform');
  assert.equal(trackerRoleForReport('099', tracker), '');
  assert.equal(trackerRoleForReport('', tracker), '');
  assert.equal(trackerRoleForReport('012', join(dir, 'missing.md')), '');
});

test('writing the copy leaves the canonical PDF and the manifest alone', async (t) => {
  const dir = scratch(t);
  const out = join(dir, 'output', 'cv-jane-doe-012-globex-2026-11-19.pdf');
  const bytes = Buffer.from('%PDF-1.7 fake');
  mkdirSync(join(dir, 'output'), { recursive: true });
  writeFileSync(out, bytes);

  const first = await writeUploadCopy(out, { fullName: 'Jane Doe', role: 'Analytics Engineer' });
  assert.equal(first, join(dir, 'output', 'upload', 'cv-jane-doe-012-globex-2026-11-19', 'Jane-Doe-Analytics-Engineer-CV.pdf'));
  assert.deepEqual(readFileSync(first), bytes);
  assert.deepEqual(readFileSync(out), bytes);
  assert.equal(existsSync(join(dir, 'data', 'pdf-index.tsv')), false);

  // A re-render refreshes the same copy instead of piling up -2, -3.
  const newer = Buffer.from('%PDF-1.7 newer');
  writeFileSync(out, newer);
  assert.equal(await writeUploadCopy(out, { fullName: 'Jane Doe', role: 'Analytics Engineer' }), first);
  assert.deepEqual(readFileSync(first), newer);
});

test('cv.upload_copy and the full name are read from the profile', (t) => {
  const dir = scratch(t);
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'candidate:\n  full_name: "Jane DOE"\ncv:\n  upload_copy: true\n');
  assert.deepEqual(readUploadCopySettings(profile), { fullName: 'Jane DOE', uploadCopy: true });
  writeFileSync(profile, 'candidate:\n  full_name: Jane Doe\n');
  assert.deepEqual(readUploadCopySettings(profile), { fullName: 'Jane Doe', uploadCopy: false });
  writeFileSync(profile, 'cv:\n  upload_copy: "yes"\n');
  assert.equal(readUploadCopySettings(profile).uploadCopy, false);
  assert.match(readUploadCopySettings(profile).invalid, /cv\.upload_copy "yes" is not true or false/);
  assert.deepEqual(readUploadCopySettings(join(dir, 'missing.yml')), { fullName: '', uploadCopy: false });
});
