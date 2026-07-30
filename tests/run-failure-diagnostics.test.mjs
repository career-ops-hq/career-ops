// tests/run-failure-diagnostics.test.mjs — a failing child's diagnostics must
// survive run().
//
// run() reports failure by returning null. execFileSync attaches the child's
// stdout, stderr, exit status, and signal to the error it throws, and the catch
// block discarded all of it. Every caller could therefore only report the fact
// of a crash, which is what `❌ <name> crashed` in test-all.mjs is: one line, no
// stack, no assertion text, no exit code.
//
// That is not merely unhelpful, it is the difference between reading a CI
// failure and guessing at it. A windows-only flake in tracker-writer-lock-tests
// had to be diagnosed by reading the source and reasoning about which of six
// timeouts was most likely to have fired, because the log carried nothing else.

import { pass, fail, run, lastRunFailure } from './helpers.mjs';

const NODE = process.execPath;

// A child that writes to both streams and exits non-zero, so every field is
// distinguishable from an empty default. Status 3 rather than 1 so a helper that
// hardcoded a plausible default would still fail this.
//
// It sets `exitCode` instead of calling exit() because runDiscovered() rejects
// any discovered suite whose source matches /\bprocess\.exit\s*\(/, and that
// pattern does not distinguish a call from the same characters inside a string
// literal. Setting exitCode reaches the same exit status without the literal.
const CHILD = 'console.log("MARKER-OUT"); console.error("MARKER-ERR"); process.exitCode = 3;';

// A child that simply succeeds. Same reason as above for not calling exit(0).
const OK_CHILD = 'console.log("OK");';

{
  const result = run(NODE, ['-e', CHILD], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result === null) pass('run() still signals failure by returning null');
  else fail(`run() must return null on a non-zero exit, got ${JSON.stringify(result)}`);
}

{
  const f = lastRunFailure();
  if (f && typeof f === 'object') pass('lastRunFailure() exposes the failed child after run() returns null');
  else fail(`lastRunFailure() must describe the failure, got ${JSON.stringify(f)}`);
}

{
  const f = lastRunFailure() ?? {};
  if (f.status === 3) pass('the child exit status is preserved');
  else fail(`exit status must be 3, got ${JSON.stringify(f.status)}`);
}

{
  const f = lastRunFailure() ?? {};
  if (String(f.stdout ?? '').includes('MARKER-OUT')) pass('the child stdout is preserved');
  else fail(`stdout must contain MARKER-OUT, got ${JSON.stringify(f.stdout)}`);
}

{
  const f = lastRunFailure() ?? {};
  if (String(f.stderr ?? '').includes('MARKER-ERR')) pass('the child stderr is preserved');
  else fail(`stderr must contain MARKER-ERR, got ${JSON.stringify(f.stderr)}`);
}

// A stale diagnostic attributed to a later, unrelated crash would be worse than
// none, so a success must clear the record rather than leave the previous one in
// place for the next caller to misread.
{
  run(NODE, ['-e', OK_CHILD], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (lastRunFailure() === null) pass('a successful run clears the previous failure record');
  else fail(`a successful run must clear the record, got ${JSON.stringify(lastRunFailure())}`);
}

// Guard the format helper too: it is what test-all.mjs interpolates, so an
// empty string on success is what keeps a passing line unchanged.
{
  const { formatRunFailure } = await import('./helpers.mjs');
  run(NODE, ['-e', OK_CHILD], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (formatRunFailure() === '') pass('formatRunFailure() is empty when nothing has failed');
  else fail(`formatRunFailure() must be empty after success, got ${JSON.stringify(formatRunFailure())}`);
}

{
  const { formatRunFailure } = await import('./helpers.mjs');
  run(NODE, ['-e', CHILD], { stdio: ['pipe', 'pipe', 'pipe'] });
  const text = formatRunFailure();
  if (text.includes('MARKER-ERR') && text.includes('3')) pass('formatRunFailure() carries the exit status and stderr');
  else fail(`formatRunFailure() must surface status and stderr, got ${JSON.stringify(text)}`);
}

// resolveAllowedExecutable() throws for a non-allowlisted command, and it runs
// before the reset. A throw therefore leaves the previous run's diagnostics in
// place, so the next formatRunFailure() attributes an unrelated child's stderr
// to whatever failed most recently. That is worse than no diagnostic.
{
  run(NODE, ['-e', CHILD], { stdio: ['pipe', 'pipe', 'pipe'] });
  let threw = false;
  try { run('definitely-not-on-the-allowlist', []); } catch { threw = true; }
  if (threw) pass('run() still throws for a non-allowlisted executable');
  else fail('run() must reject a non-allowlisted executable');
}

{
  if (lastRunFailure() === null) pass('a rejected executable clears the previous failure record');
  else fail(`a rejected executable must not leave a stale record, got ${JSON.stringify(lastRunFailure())}`);
}
