#!/usr/bin/env node
/**
 * run-bounded.mjs — run one node script under a timeout, with no one waiting.
 *
 *   node lib/run-bounded.mjs <timeoutMs> <script> [args...]
 *
 * set-status.mjs --detach-jd-archive starts this as a detached child so the
 * caller gets its answer as soon as the tracker is written, while the archive
 * still runs under CAREER_OPS_JD_ARCHIVE_TIMEOUT_MS. A detached child has no
 * parent left to enforce that bound, so this process is the one that holds it:
 * execFileSync kills the script when the timeout passes.
 *
 * Output is discarded. Nobody is reading it, and an inherited pipe would make
 * the caller wait for this process to close it, which is what detaching avoids.
 *
 * windowsHide is required, not cosmetic. On Windows a detached child is
 * started with DETACHED_PROCESS, so this runner has no console, and a console
 * program it starts without windowsHide gets a new console of its own: a
 * visible window for as long as the archive runs. With it, the script gets a
 * console with no window, and so does everything the script starts.
 */

import { execFileSync } from 'node:child_process';

const [timeoutArg, script, ...args] = process.argv.slice(2);
const timeout = Number(timeoutArg);
if (!script || !Number.isInteger(timeout) || timeout <= 0) {
  console.error('Usage: node lib/run-bounded.mjs <timeoutMs> <script> [args...]');
  process.exit(2);
}

try {
  execFileSync(process.execPath, [script, ...args], { stdio: 'ignore', timeout, windowsHide: true });
} catch (err) {
  // Warn-only by design, the same as the waited-for path in set-status.mjs.
  // set-status starts this with stdio 'ignore', so this line is seen only when
  // the runner is invoked by hand to diagnose an archive.
  const why = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM' ? `timed out after ${timeout}ms` : (err?.message ?? String(err));
  console.error(`run-bounded: ${script} failed: ${String(why).split('\n')[0]}`);
  process.exitCode = 1;
}
