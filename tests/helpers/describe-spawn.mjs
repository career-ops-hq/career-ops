// tests/helpers/describe-spawn.mjs — why a child process failed, in a message
// that always names a cause.
//
// A SEPARATE module from tests/helpers.mjs, which is not free to import: it
// sets process.env.CAREER_OPS_TRACKER, calls pinSandboxDataRoot() and registers
// an 'exit' hook at load. 51 of the test files that need this helper do not
// import helpers.mjs today, and making them do so just to reach one pure
// function would hand them that environment as well. helpers.mjs re-exports it
// for the files that already depend on it.

/**
 * Why a spawnSync/execFileSync result failed, in a message that always names a
 * cause.
 *
 * The common shape is `assert.equal(r.status, 0, r.stderr)`, or
 * `${r.stdout}${r.stderr}`. That reads well for a child that ran and printed a
 * complaint, and says NOTHING for a child that never got to print:
 *
 *   spawnSync(node, [...], { timeout: 20_000 })
 *   -> status null, signal SIGTERM, error ETIMEDOUT, stdout "", stderr ""
 *
 * so the assertion message is the empty string and the failure reads
 * "AssertionError: --status Applied:" with no reason at all. That is a real
 * CI failure on windows-latest, not a hypothetical: a slow runner killed the
 * child at the 20s timeout and the report could not say so, which is why it
 * looked like a logic failure in the thing under test.
 *
 * `status` can be null, `signal` says a kill, and `error` carries ETIMEDOUT or
 * ENOENT. All three are in the result and all three were being thrown away.
 * Empty streams are printed as "(empty)" rather than as nothing, so a reader
 * can tell silence from a truncated message.
 *
 * @param {import('child_process').SpawnSyncReturns<string>} result
 * @param {string} [label] - What was being run, for the first line.
 * @returns {string}
 */
export function describeSpawn(result, label = '') {
  const parts = [];
  if (label) parts.push(label);
  if (result?.error) {
    const code = result.error.code ? `${result.error.code}: ` : '';
    parts.push(`spawn error — ${code}${result.error.message}`);
  }
  if (result?.signal) parts.push(`killed by signal ${result.signal}`);
  const status = result?.status;
  parts.push(status === null || status === undefined
    ? `exit status ${status === null ? 'null' : 'undefined'} (the process did not exit on its own)`
    : `exit status ${status}`);
  const stream = (name, value) => {
    const t = String(value ?? '').trim();
    return t ? `${name}:\n${t}` : `${name}: (empty)`;
  };
  parts.push(stream('stdout', result?.stdout));
  parts.push(stream('stderr', result?.stderr));
  return parts.join('\n  ');
}

/**
 * Did the child RUN and choose a non-zero exit?
 *
 * `assert.notEqual(result.status, 0)` is the usual way to say "this command
 * must fail", and it passes for three different reasons:
 *
 *   the CLI rejected the input   status 1     <- the only one meant
 *   the child was killed         status null  <- timeout, SIGTERM
 *   the child never started      status null  <- ENOENT, EACCES
 *
 * `null !== 0`, so a command that was killed at its `timeout:` or could not be
 * spawned at all satisfies the assertion. The test then reports success while
 * proving nothing about the behaviour it names: a slow CI runner turns "the
 * CLI refuses a malformed bound" green without the CLI ever having parsed the
 * bound. That is strictly worse than the empty failure message describeSpawn
 * was written for — a confusing red costs an afternoon, a false green hides a
 * regression for as long as it survives.
 *
 * So the check is positive: no spawn error, no signal, and an integer status
 * that is not 0. An exit code is a decision the program made; a kill is not.
 *
 * Platform limit: Windows has no POSIX signal delivery, so a child terminated
 * by a signal reports a non-zero NATIVE status and no signal, and this cannot
 * tell it apart from a chosen exit there. A `timeout:` kill is still caught on
 * every platform, because spawnSync sets `error` to ETIMEDOUT — and that is
 * the case these assertions were actually exposed to.
 *
 * Pair it with describeSpawn for the message, which then names which of the
 * three happened:
 *
 *   assert.ok(exitedNonZero(r), describeSpawn(r, 'a malformed bound must fail'));
 *
 * @param {import('child_process').SpawnSyncReturns<string>} result
 * @returns {boolean}
 */
export function exitedNonZero(result) {
  if (!result) return false;
  if (result.error) return false;   // never ran: ENOENT, EACCES, ETIMEDOUT
  if (result.signal) return false;  // killed; it did not choose this
  return Number.isInteger(result.status) && result.status !== 0;
}
