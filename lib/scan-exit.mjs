/**
 * scan-exit.mjs — the exit rule every scanner shares when it reads nothing
 * (#5720).
 *
 * Exit 2 means the scan ran but no target could be read; 0 means at least one
 * target was read, or nothing was configured (an empty search list tried
 * nothing and is not an outage); 1 stays reserved for a config or fatal error.
 * Only "every" target failing is a failure: one dead board is routine, and
 * treating it as a failure would turn every scheduled run red.
 * docs/AUTOMATION.md §1 has the contract.
 *
 * Always set `process.exitCode`, never call `process.exit()`: on Windows, Node
 * can abort when process.exit() runs right after a request (nodejs/node#56645,
 * #3788), and setting the code lets buffered output flush.
 */

export const EXIT_EVERY_TARGET_FAILED = 2;

/**
 * @param {{attempted: number, read: number}} counts
 * @returns {boolean} true when at least one target was attempted and none was
 *   read.
 */
export function everyTargetFailed({ attempted, read }) {
  return Number.isFinite(attempted) && attempted > 0 && read === 0;
}

/**
 * When every attempted target failed, print scan.mjs's last-line message to
 * stderr and set the exit code.
 *
 * @param {{attempted: number, read: number, unit: string, thing: string}} run
 *   unit  — what was tried, singular, e.g. 'TopDev search', 'Dayforce board'
 *   thing — what could not be read, singular, e.g. 'results page', 'board'
 * @param {{error?: (msg: string) => void, proc?: {exitCode?: number|string|undefined}}} [io]
 *   injectable for tests; defaults to console.error and the real process.
 * @returns {boolean} whether it set the exit code.
 */
export function exitIfEveryTargetFailed({ attempted, read, unit, thing }, io = {}) {
  const error = io.error ?? ((msg) => console.error(msg));
  const proc = io.proc ?? process;
  if (!everyTargetFailed({ attempted, read })) return false;
  error(`Error: every ${unit} failed (${attempted} of ${attempted}); no ${thing} could be read. See the errors above.`);
  proc.exitCode = EXIT_EVERY_TARGET_FAILED;
  return true;
}
