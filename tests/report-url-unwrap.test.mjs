#!/usr/bin/env node
/**
 * Report **URL:** tokens often arrive as markdown autolinks with trailing
 * punctuation from the inline header: `<https://…/job>,` or `<https://…>).`.
 * Strip punctuation before the angle brackets. The other order leaves a
 * trailing `>`, which breaks URL dedup and duplicate-report checks.
 *
 * Run: node test-all.mjs --only report-url-unwrap
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { unwrapReportUrlToken } from '../tracker-parse.mjs';
import { normalizeUrl } from '../url-key.mjs';

console.log('\nReport URL token unwrap (angle brackets + trailing punctuation)');

const cases = [
  ['<https://boards.greenhouse.io/acme/jobs/123>,', 'https://boards.greenhouse.io/acme/jobs/123'],
  ['<https://boards.greenhouse.io/acme/jobs/123>).', 'https://boards.greenhouse.io/acme/jobs/123'],
  ['<https://boards.greenhouse.io/acme/jobs/123>', 'https://boards.greenhouse.io/acme/jobs/123'],
  ['https://boards.greenhouse.io/acme/jobs/123,', 'https://boards.greenhouse.io/acme/jobs/123'],
  ['https://boards.greenhouse.io/acme/jobs/123', 'https://boards.greenhouse.io/acme/jobs/123'],
  ['N/A', 'N/A'],
];

for (const [input, expected] of cases) {
  const got = unwrapReportUrlToken(input);
  if (got === expected) pass(`unwrap ${JSON.stringify(input)}`);
  else fail(`unwrap ${JSON.stringify(input)}: got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
}

{
  const dirty = unwrapReportUrlToken('<https://boards.greenhouse.io/acme/jobs/123>,');
  const clean = unwrapReportUrlToken('https://boards.greenhouse.io/acme/jobs/123');
  if (normalizeUrl(dirty) === normalizeUrl(clean) && normalizeUrl(dirty) !== '') {
    pass('unwrapped angle+comma URL shares a normalizeUrl key with the bare URL');
  } else {
    fail(`normalizeUrl keys diverge: dirty=${JSON.stringify(normalizeUrl(dirty))} clean=${JSON.stringify(normalizeUrl(clean))}`);
  }
}

{
  const work = mkdtempSync(join(tmpdir(), 'co-url-unwrap-bf-'));
  try {
    mkdirSync(join(work, 'reports'), { recursive: true });
    mkdirSync(join(work, 'adds'), { recursive: true });
    writeFileSync(join(work, 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Status | Score | PDF | Report | Notes | URL |
|---|------|---------|------|--------|-------|-----|--------|-------|-----|
| 1 | 2026-10-01 | Acme | Platform Engineer | Evaluated | 4.1/5 | ❌ | [1](reports/001-acme-2026-10-01.md) | |  |
`);
    writeFileSync(
      join(work, 'reports/001-acme-2026-10-01.md'),
      '# Acme — Platform Engineer\n\n**Score:** 4.1/5 | **URL:** <https://boards.greenhouse.io/acme/jobs/123>, | **PDF:** -\n',
    );
    execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs'), '--backfill-urls'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: join(work, 'applications.md'),
        CAREER_OPS_ADDITIONS: join(work, 'adds'),
        CAREER_OPS_DATA_DIR: work,
        CAREER_OPS_ROOT: work,
      },
      timeout: 30000,
    });
    const row = readFileSync(join(work, 'applications.md'), 'utf8').split('\n').find((l) => /^\| 1 /.test(l));
    const urlCell = row.split('|')[10].trim();
    if (urlCell.includes('>') || urlCell.endsWith('%3E')) {
      fail(`backfill left a trailing angle bracket in the URL cell: ${JSON.stringify(urlCell)}`);
    } else if (urlCell.includes('boards.greenhouse.io/acme/jobs/123')) {
      pass('merge --backfill-urls writes a clean URL from an angle+comma report header');
    } else {
      fail(`backfill did not fill the expected URL: ${JSON.stringify(urlCell)}`);
    }

    writeFileSync(
      join(work, 'adds/002.tsv'),
      '2\t2026-10-02\tAcme\tData Analyst\tEvaluated\t4.0/5\t❌\t[2](reports/002-acme-2026-10-02.md)\tre\t\thttps://boards.greenhouse.io/acme/jobs/123\n',
    );
    writeFileSync(
      join(work, 'reports/002-acme-2026-10-02.md'),
      '# Acme — Data Analyst\n\n**Score:** 4.0/5 | **URL:** https://boards.greenhouse.io/acme/jobs/123\n',
    );
    const mergeOut = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: join(work, 'applications.md'),
        CAREER_OPS_ADDITIONS: join(work, 'adds'),
        CAREER_OPS_DATA_DIR: work,
        CAREER_OPS_ROOT: work,
      },
      timeout: 30000,
    });
    const rows = readFileSync(join(work, 'applications.md'), 'utf8').split('\n').filter((l) => /^\| \d+/.test(l));
    if (rows.length === 1 && /🔄1 updated|updated/.test(mergeOut)) {
      pass('after a clean backfill, a same-URL addition updates instead of adding a duplicate row');
    } else if (rows.length === 1) {
      pass('after a clean backfill, a same-URL addition keeps a single tracker row');
    } else {
      fail(`same-URL addition produced ${rows.length} rows after backfill:\n${rows.join('\n')}\n${mergeOut}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  const work = mkdtempSync(join(tmpdir(), 'co-url-unwrap-vp-'));
  try {
    mkdirSync(join(work, 'data'), { recursive: true });
    mkdirSync(join(work, 'reports'), { recursive: true });
    writeFileSync(join(work, 'data/applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-10-01 | Acme | Engineer | 4.1/5 | Evaluated | ❌ | [1](reports/001-acme-2026-10-01.md) | |
| 2 | 2026-10-02 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [2](reports/002-acme-2026-10-02.md) | |
`);
    writeFileSync(
      join(work, 'reports/001-acme-2026-10-01.md'),
      '# Acme — Engineer\n\n**Score:** 4.1/5 | **URL:** <https://jobs.example.test/acme/role>, | **PDF:** -\n',
    );
    writeFileSync(
      join(work, 'reports/002-acme-2026-10-02.md'),
      '# Acme — Engineer\n\n**Score:** 4.0/5 | **URL:** <https://jobs.example.test/acme/role> | **PDF:** -\n',
    );
    const out = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CAREER_OPS_ROOT: work,
        CAREER_OPS_DATA_DIR: join(work, 'data'),
        CAREER_OPS_TRACKER: join(work, 'data/applications.md'),
      },
      timeout: 30000,
    });
    if (/Duplicate reports for same company\+role/.test(out)) {
      pass('verify-pipeline flags duplicate reports when one URL is angle+comma wrapped');
    } else {
      fail(`verify-pipeline missed the duplicate reports:\n${out}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
