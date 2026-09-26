// Regression (#4385): reserve-report-num.mjs and merge-tracker.mjs disagreed
// on batch-state "failed" rows. reserve-report-num.mjs computed occupancy
// from report files and tracker rows only, so it re-issued a number that
// batch-state.tsv marks "failed" -- and merge-tracker.mjs's anti-fabrication
// guard then refuses to merge a tracker line for that exact number. The two
// scripts must agree: a number batch-state marks "failed" is not available.

import { strict as assert } from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reserveReportNumbers, releaseReportNumbers } from '../reserve-report-num.mjs';
import { pass, fail } from './helpers.mjs';

async function reserveIn(dir) {
  // Pass the fixture path explicitly so a CAREER_OPS_BATCH_STATE set in the
  // caller's environment cannot redirect these tests to another file.
  const nums = await reserveReportNumbers(1, {
    rootDir: dir,
    batchStateFile: join(dir, 'batch/batch-state.tsv'),
  });
  await releaseReportNumbers(nums, { rootDir: dir });
  return String(nums[0]).padStart(3, '0');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'rrn-failed-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'batch'), { recursive: true });
    writeFileSync(
      join(dir, 'data/applications.md'),
      '# Applications Tracker\n\n'
      + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|---|---|---|---|---|---|---|---|\n'
    );
    // No report files or tracker rows occupy 001 -- only batch-state.tsv
    // marks it "failed" for a job that never produced a report.
    writeFileSync(
      join(dir, 'batch/batch-state.tsv'),
      'id\turl\tstatus\tstarted\tcompleted\treport_num\tscore\terror\tretries\n'
      + 'job-1\thttps://example.com/job\tfailed\t2026-09-01T00:00:00Z\t\t001\t\tsession limit\t1\n'
    );

    const got = await reserveIn(dir);
    if (got === '002') {
      pass(`reserve skips a batch-state "failed" number → ${got}`);
    } else {
      fail(`reserve re-issued a batch-state "failed" number: expected 002, got ${got}`);
    }
  } catch (err) {
    fail(`reserve-report-num failed-batch-state test threw: ${err.message.split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A "failed" row with no report_num (still running / never claimed a slot)
// must not occupy anything.
{
  const dir = mkdtempSync(join(tmpdir(), 'rrn-failed-none-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'batch'), { recursive: true });
    writeFileSync(
      join(dir, 'data/applications.md'),
      '# Applications Tracker\n\n'
      + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|---|---|---|---|---|---|---|---|\n'
    );
    writeFileSync(
      join(dir, 'batch/batch-state.tsv'),
      'id\turl\tstatus\tstarted\tcompleted\treport_num\tscore\terror\tretries\n'
      + 'job-1\thttps://example.com/job\tfailed\t2026-09-01T00:00:00Z\t\t-\t\tsession limit\t1\n'
    );

    const got = await reserveIn(dir);
    assert.equal(got, '001');
    pass(`reserve ignores a batch-state "failed" row with no report_num → ${got}`);
  } catch (err) {
    fail(`reserve-report-num failed-no-num test threw: ${err.message.split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A corrupt "failed" row must not poison occupancy: "12abc" is not a number
// and 9007199254740992 is not a safe integer. Both are ignored, so the next
// free slot is still 001.
{
  const dir = mkdtempSync(join(tmpdir(), 'rrn-failed-corrupt-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'batch'), { recursive: true });
    writeFileSync(
      join(dir, 'data/applications.md'),
      '# Applications Tracker\n\n'
      + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|---|---|---|---|---|---|---|---|\n'
    );
    writeFileSync(
      join(dir, 'batch/batch-state.tsv'),
      'id\turl\tstatus\tstarted\tcompleted\treport_num\tscore\terror\tretries\n'
      + 'job-1\thttps://example.com/a\tfailed\t2026-09-01T00:00:00Z\t\t12abc\t\tsession limit\t1\n'
      + 'job-2\thttps://example.com/b\tfailed\t2026-09-01T00:00:00Z\t\t9007199254740992\t\tsession limit\t1\n'
    );

    const got = await reserveIn(dir);
    assert.equal(got, '001');
    pass(`reserve ignores corrupt batch-state "failed" report numbers → ${got}`);
  } catch (err) {
    fail(`reserve-report-num failed-corrupt test threw: ${err.message.split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
