// tests/scan-flag-forms.test.mjs — scan.mjs must read --flag=value, not only
// --flag value.
//
// `args.indexOf('--posted-after')` returns -1 for `--posted-after=2026-07-28`,
// so the bound resolved to null — indistinguishable from the flag never having
// been passed. The run then scanned with NO date bound and reported a clean
// result, which is the failure mode lib/cli-flags.mjs was written to end
// (#2401/#2402/#2498, and 37055d7d which fixed five other scripts).
//
// The sharpest symptom is that the typo guard stops guarding: scan.mjs
// validates --posted-after and exits 1 on a malformed date precisely "since a
// silently-ignored bound would look like 'no jobs matched' instead of an
// error" — but with the = form the value never reached the validator, so a
// typo'd bound was silently ignored, which is the exact outcome the guard
// exists to prevent.
//
// Asserting via the validator is deliberate: it is observable without a
// portals.yml, a network call, or a fixture board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const runScan = (...args) =>
  spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });

for (const flag of ['--posted-after', '--posted-before']) {
  test(`${flag}=BAD is validated, not silently ignored`, () => {
    const r = runScan(`${flag}=not-a-date`);
    assert.match(
      `${r.stderr}${r.stdout}`,
      new RegExp(`${flag} expects YYYY-MM-DD`),
      `${flag}=value must reach the date validator`,
    );
    assert.notEqual(r.status, 0, 'a malformed bound must fail the run');
  });

  test(`${flag} BAD (space form) still validated`, () => {
    const r = runScan(flag, 'not-a-date');
    assert.match(`${r.stderr}${r.stdout}`, new RegExp(`${flag} expects YYYY-MM-DD`));
    assert.notEqual(r.status, 0);
  });

  test(`${flag}=VALID passes validation`, () => {
    const r = runScan(`${flag}=2026-07-28`);
    // It fails later (no portals.yml in a bare checkout) — the point is that it
    // gets *past* the date validator rather than being rejected as malformed.
    assert.doesNotMatch(`${r.stderr}${r.stdout}`, new RegExp(`${flag} expects YYYY-MM-DD`));
  });
}
