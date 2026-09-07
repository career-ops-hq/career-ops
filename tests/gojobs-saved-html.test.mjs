import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseFiles, parseSavedHtml } from '../parse-gojobs-html.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/gojobs-search-results.html', import.meta.url));

test('parses English rows from legacy and current ASP.NET control prefixes', () => {
  assert.deepEqual(parseFiles([FIXTURE]), [
    { title: 'Learning Systems Specialist', url: 'https://www.gojobs.gov.on.ca/Preview.aspx?JobID=249065&Language=English', company: 'Ministry of Example Services', location: 'Toronto, Toronto Region', closingDate: 'Friday, September 18, 2026 11:59 pm EDT', jobId: '249065' },
    { title: 'Data & Reporting Analyst', url: 'https://www.gojobs.gov.on.ca/Preview.aspx?JobID=249066&Language=English', company: 'Ontario Public Service', location: 'London, West Region', closingDate: 'Monday, September 21, 2026 11:59 pm EDT', jobId: '249066' },
  ]);
});

test('deduplicates repeated postings across saved pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gojobs-parser-'));
  const html = '<a id="ctl00_Content_rptSearchResult_ctl01_lnkJobTitleEN" href="Preview.aspx?JobID=42&amp;Language=English">Role</a>';
  writeFileSync(join(dir, 'page-1.html'), html); writeFileSync(join(dir, 'page-2.htm'), html);
  assert.equal(parseFiles([dir]).length, 1);
});

test('fails loudly on a saved Radware challenge', () => {
  assert.throws(() => parseSavedHtml('<title>Radware Captcha Page</title>', 'challenge.html'), /Radware challenge/);
});

test('fails loudly when only the bare search form was saved', () => {
  assert.throws(() => parseSavedHtml('<form action="Search.aspx"></form>', 'form.html'), /no GO Jobs result rows found/);
});
