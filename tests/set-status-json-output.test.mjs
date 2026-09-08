import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';

console.log('\nset-status.mjs — JSON result must be the final stdout output #3855');

const work = mkdtempSync(join(tmpdir(), 'cops-set-status-'));
const tracker = join(work, 'data', 'applications.md');

function parseFinalJson(stdout, label) {
  try {
    const result = JSON.parse(stdout);

    // JSON.parse() already rejects any non-whitespace after the JSON document.
    // This additionally makes the "closing brace + optional whitespace" rule explicit.
    if (!/}\s*$/.test(stdout)) {
      fail(`${label} JSON is not the final stdout output`);
      return null;
    }

    pass(`${label} JSON is the final stdout output`);
    return result;
  } catch {
    fail(`${label} stdout is not one JSON document: ${JSON.stringify(stdout)}`);
    return null;
  }
}

try {
  mkdirSync(join(work, 'data'), { recursive: true });

  writeFileSync(
    tracker,
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-09-08 | Acme | Python Developer | 4.5/5 | Evaluated | — | — | — |',
      '',
    ].join('\n'),
  );

  const env = {
    ...process.env,
    CAREER_OPS_ROOT: work,
    CAREER_OPS_TRACKER: tracker,
  };

  // SUCCESS CASE

  const success = spawnSync(
    NODE,
    [
      join(ROOT, 'set-status.mjs'),
      '--row',
      '1',
      'Interview',
      '--json',
    ],
    {
      encoding: 'utf-8',
      timeout: 30000,
      env,
    },
  );

  const successStdout = success.stdout || '';

  if (success.status === 0) {
    pass('successful set-status command exits 0');
  } else {
    fail(
      `successful set-status command should exit 0, got ${success.status}: ` +
      JSON.stringify(successStdout),
    );
  }

  const successResult = parseFinalJson(successStdout, 'success');

  if (
    successResult &&
    successResult.changed === true &&
    successResult.newStatus === 'Interview'
  ) {
    pass('success stdout contains the expected JSON result');
  } else if (successResult) {
    fail(`unexpected success JSON: ${JSON.stringify(successResult)}`);
  }

  const trackerAfterSuccess = readFileSync(tracker, 'utf-8');

  if (
    trackerAfterSuccess.includes(
      '| 1 | 2026-09-08 | Acme | Python Developer | 4.5/5 | Interview |',
    )
  ) {
    pass('success case actually updates applications.md');
  } else {
    fail('success case did not update applications.md to Interview');
  }

  if (existsSync(join(work, 'data', 'status-log.tsv'))) {
    pass('success case writes status-log.tsv');
  } else {
    fail('success case did not create status-log.tsv');
  }

  // FAILURE CASE

  const failure = spawnSync(
    NODE,
    [
      join(ROOT, 'set-status.mjs'),
      '--row',
      '1',
      'NotARealStatus',
      '--json',
    ],
    {
      encoding: 'utf-8',
      timeout: 30000,
      env,
    },
  );

  const failureStdout = failure.stdout || '';

  if (failure.status !== 0) {
    pass('failed set-status command exits non-zero');
  } else {
    fail('failed set-status command should exit non-zero');
  }

  const failureResult = parseFinalJson(failureStdout, 'failure');

  if (
    failureResult &&
    failureResult.error &&
    failureResult.code === 'invalid-state'
  ) {
    pass('failure stdout contains the expected JSON error');
  } else if (failureResult) {
    fail(`unexpected failure JSON: ${JSON.stringify(failureResult)}`);
  }

} finally {
  console.log(`Temporary test directory: ${work}`);
  // rmSync(work, { recursive: true, force: true });    uncomment it for auto cleanup of files
}