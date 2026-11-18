// tests/ci-approve-changed-files.test.mjs — a truncated file list must not read
// as a clean one.
//
// `decide()` approves a held fork run when the PR touches neither `.github/**`
// nor a dependency file. It judged that from `pulls/{n}/files`, which GitHub
// caps, so a PR with more changed files than the API returns can hide one in the
// tail. Approving is not a comment: the run then executes the fork's code.
//
// OFFLINE: `decide()` is pure. Importing the module runs nothing (loadEnv() is
// called from main(), not at import time), so no token and no network are
// involved.
//
// Run:  node --test tests/ci-approve-changed-files.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../.github/scripts/ci-approve.mjs';

const SHA = 'abc1234def';

/** A held run's PR that would be approved if the file list were complete. */
function pr(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    head: { sha: SHA },
    user: { login: 'contributor', type: 'User' },
    changed_files: 2,
    ...overrides,
  };
}

const safe = [{ filename: 'README.md' }, { filename: 'docs/setup.md' }];

test('approves a PR whose file list matches what the PR declares', () => {
  const verdict = decide({ sha: SHA, pr: pr(), files: safe });
  assert.equal(verdict.ok, true, verdict.why);
});

test('refuses when the file list is shorter than the PR declares', () => {
  // 3001 declared, 3000 returned: the tail was never read.
  const verdict = decide({
    sha: SHA,
    pr: pr({ changed_files: 3001 }),
    files: safe,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /incompleta/);
  assert.match(verdict.why, /2 de 3001/);
});

test('refuses an incomplete list even when every file it DID read is harmless', () => {
  // This is the regression: the old rule only looked for a forbidden file among
  // the ones it could see, so a clean prefix approved the PR.
  const verdict = decide({
    sha: SHA,
    pr: pr({ changed_files: 500 }),
    files: [{ filename: 'src/index.mjs' }],
  });
  assert.equal(verdict.ok, false, 'a clean but short list must not be approved');
});

test('an unknown file count is refused, not assumed harmless', () => {
  // `changed_files` comes from the PR detail (`GET pulls/{n}`); the open-PR list
  // this script used before does not carry it. Reading the count from there made
  // the comparison a no-op. Not knowing the count is the "could not see" case, so
  // it is refused rather than approved.
  const verdict = decide({ sha: SHA, pr: pr({ changed_files: undefined }), files: safe });
  assert.equal(verdict.ok, false, 'an unknown count must not be approved');
  assert.match(verdict.why, /cu[aá]ntos ficheros/);
});

test('an incomplete list does not excuse a forbidden file it did see', () => {
  const verdict = decide({
    sha: SHA,
    pr: pr({ changed_files: 9 }),
    files: [{ filename: '.github/workflows/test.yml' }],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /incompleta|toca/);
});