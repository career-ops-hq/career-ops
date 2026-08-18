// tests/scan-flag-forms.test.mjs — scan.mjs must read --flag=value, not only
// --flag value, and must reject a flag passed with no operand.
//
// `args.indexOf('--posted-after')` returns -1 for `--posted-after=2026-07-28`,
// so the bound resolved to null — indistinguishable from the flag never having
// been passed. The run then scanned with NO date bound and reported a clean
// result, which is the failure mode lib/cli-flags.mjs was written to end
// (#2401/#2402/#2498, and 37055d7d which fixed five other scripts).
//
// The sharpest symptom is that the typo guard stops guarding: scan.mjs
// validates these dates and exits 1 on a malformed one precisely "since a
// silently-ignored bound would look like 'no jobs matched' instead of an
// error" — but with the = form the value never reached the validator, so a
// typo'd bound was silently ignored, the exact outcome the guard exists to
// prevent.
//
// HERMETIC: every run pins CAREER_OPS_PORTALS at a path that does not exist, so
// scan.mjs stops at its portals check and can never load providers, reach the
// network, or write scan state — regardless of whether the developer running
// the suite has a real portals.yml. Each assertion also checks the subprocess
// actually ran (no spawn error, no signal), so a timeout cannot pass silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_PORTALS = join(tmpdir(), 'career-ops-no-such-portals.yml');

function runScan(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_PORTALS: NO_PORTALS },
  });
  assert.equal(r.error, undefined, `scan.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `scan.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

for (const flag of ['--posted-after', '--posted-before']) {
  const expects = new RegExp(`${flag} expects YYYY-MM-DD`);

  test(`${flag}=BAD is validated, not silently ignored`, () => {
    const r = runScan(`${flag}=not-a-date`);
    assert.match(r.all, expects, `${flag}=value must reach the date validator`);
    assert.notEqual(r.status, 0, 'a malformed bound must fail the run');
  });

  test(`${flag} BAD (space form) still validated`, () => {
    const r = runScan(flag, 'not-a-date');
    assert.match(r.all, expects);
    assert.notEqual(r.status, 0);
  });

  test(`${flag}=VALID reaches the validator and passes it`, () => {
    const r = runScan(`${flag}=2026-07-28`);
    assert.doesNotMatch(r.all, expects, 'a valid date must not be rejected');
    // Proof it got PAST the date gate rather than never reaching it: the run
    // stops at the pinned-missing portals file, which is checked afterwards.
    assert.match(r.all, /portals\.yml not found|not found/i);
  });

  test(`${flag} with no operand is rejected, not treated as absent`, () => {
    const r = runScan(flag);
    assert.match(r.all, new RegExp(`${flag} requires a value`));
    assert.notEqual(r.status, 0, 'a missing operand must not fall back to no bound');
  });
}

test('--company=VALUE reaches the filter (regression for the = form)', () => {
  // A bare indexOf missed this too, silently scanning every tracked company.
  const r = runScan('--company=acme');
  assert.doesNotMatch(r.all, /--company requires a value/);
  assert.match(r.all, /portals\.yml not found|not found/i);
});

test('--company with no operand is rejected', () => {
  const r = runScan('--company');
  assert.match(r.all, /--company requires a value/);
  assert.notEqual(r.status, 0);
});
