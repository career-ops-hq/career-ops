// tests/calibrate-columns.test.mjs — calibrate must read the tracker through
// the detected column layout. resolveColumns() takes the file's lines; handed
// the header STRING it iterates characters, finds no header, and falls back to
// the legacy fixed layout — so a tracker with an inserted column (Location,
// #2274) reads Score from the wrong cell and calibrate reports "0 resolved".
import { pass, fail, ROOT, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncalibrate — tracker column detection');

const { loadTrackerRows } = await import(pathToFileURL(join(ROOT, 'calibrate.mjs')).href);

const dir = mkdtempSync(join(tmpdir(), 'co-calibrate-'));
try {
  const withLocation = join(dir, 'applications.md');
  writeFileSync(withLocation, [
    '| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|----------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Backend | Remote | 4.4/5 | Rejected | ✅ | [1](../reports/001-acme-2026-01-01.md) | - |',
    '| 2 | 2026-01-02 | Beta | Backend | Berlin | 3.1/5 | Interview | ❌ | [2](../reports/002-beta-2026-01-02.md) | - |',
    '',
  ].join('\n'));
  const rows = loadTrackerRows(withLocation);
  if (rows.length === 2 && rows[0].score === 4.4 && rows[0].status === 'Rejected' && rows[1].score === 3.1 && rows[1].status === 'Interview') {
    pass('a tracker with an inserted Location column is read through the detected layout');
  } else {
    fail(`inserted-column tracker parsed as ${JSON.stringify(rows)}`);
  }

  const legacy = join(dir, 'legacy.md');
  writeFileSync(legacy, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 7 | 2026-01-03 | Gamma | Backend | 3.8/5 | Offer | ✅ | [7](../reports/007-gamma-2026-01-03.md) | - |',
    '',
  ].join('\n'));
  const one = loadTrackerRows(legacy);
  if (one.length === 1 && one[0].num === 7 && one[0].score === 3.8 && one[0].status === 'Offer') pass('the plain 9-column tracker still parses');
  else fail(`legacy tracker parsed as ${JSON.stringify(one)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
