// tests/portals-default-data-root.test.mjs — fix-slugs.mjs and
// validate-portals.mjs default to the DATA ROOT's portals.yml, not the cwd's.
//
// Both defaulted to the bare string 'portals.yml', which resolves against
// process.cwd(). scan.mjs, audit-portals.mjs and verify-portals.mjs resolve the
// same default against the data root (CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR /
// .career-ops-data), so once the data lived outside the checkout these two
// worked on a different file than the scanner: `npm run validate:portals`,
// which npm always runs from the checkout, failed with "file not found" or
// validated a stale copy, and fix-slugs.mjs reported "nothing to fix" for the
// file verify-portals.mjs had just flagged.
//
// Each run points the data root and the cwd at DIFFERENT directories, so a
// default that follows the shell is caught. Offline: no config here has an
// entry that needs a network probe.
//
// Run:  node --test tests/portals-default-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_ENTRIES = 'job_boards: []\ntracked_companies: []\n';

/** A data root and a separate working directory; the caller removes both. */
function makeDirs() {
  return {
    dataRoot: mkdtempSync(join(tmpdir(), 'career-ops-portals-root-')),
    cwd: mkdtempSync(join(tmpdir(), 'career-ops-portals-cwd-')),
  };
}

function removeDirs({ dataRoot, cwd }) {
  for (const dir of [dataRoot, cwd]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/** Run `script` with no --file from `cwd`, with the data root set elsewhere. */
function runWithDefaultPath(script, { dataRoot, cwd }) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_PORTALS;
  const res = spawnSync(process.execPath, [join(ROOT, script)], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: 30000,
  });
  return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

test('validate-portals.mjs validates the data root portals.yml, not the copy in the cwd', () => {
  const dirs = makeDirs();
  try {
    // The user's file has a mistake the validator exists to catch. The copy in
    // the cwd is clean, so validating the wrong file passes.
    writeFileSync(join(dirs.dataRoot, 'portals.yml'), [
      'job_boards: []',
      'tracked_companies:',
      '  - name: Acme',
      '    provider: not-a-real-provider',
      '    careers_url: https://jobs.lever.co/acme',
      '    enabled: true',
      '',
    ].join('\n'), 'utf-8');
    writeFileSync(join(dirs.cwd, 'portals.yml'), NO_ENTRIES, 'utf-8');

    const { status, out } = runWithDefaultPath('validate-portals.mjs', dirs);

    assert.ok(
      out.includes(`validate-portals: ${join(dirs.dataRoot, 'portals.yml')}`),
      `the default path must be the data root's portals.yml, got:\n${out}`,
    );
    assert.match(out, /unknown provider "not-a-real-provider"/);
    assert.equal(status, 1, `an error in the data root's file must fail the run:\n${out}`);
  } finally {
    removeDirs(dirs);
  }
});

test('fix-slugs.mjs reads the data root portals.yml when the cwd has none', () => {
  const dirs = makeDirs();
  try {
    // A fresh checkout with the data kept elsewhere: the cwd holds no
    // portals.yml at all, which a cwd-relative default reports as nothing to do.
    writeFileSync(join(dirs.dataRoot, 'portals.yml'), NO_ENTRIES, 'utf-8');

    const { status, out } = runWithDefaultPath('fix-slugs.mjs', dirs);

    assert.equal(status, 0, out);
    assert.doesNotMatch(out, /no portals file/, `fix-slugs looked for portals.yml in the cwd:\n${out}`);
    assert.match(out, /No resolvable slug fixes found/, out);
  } finally {
    removeDirs(dirs);
  }
});
