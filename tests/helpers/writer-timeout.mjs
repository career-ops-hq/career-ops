// What a writer that ran out of time in tests/tracker-writer-lock.test.mjs was
// doing when the harness gave up on it (#5514).
//
// "Writer hung after lock release" was the only thing a timeout could say, and
// on windows-latest it said it for writers that had not hung. Measured on a
// 32-core Windows box: idle, tracker-delete leaves 0.1-0.15 s after the
// release and reply-watch 0.2-0.35 s. Starved with 64-96 busy processes, both
// time out, and in 18 of 24 timeouts the writer had not yet reached the lock
// when it was released: its own start-up ate the budget. A preload showed no
// handle holding any of them open. So a timeout now says which of three
// things it saw.

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * One line saying what a writer that timed out had got to.
 *
 * @param {object} t - Times in ms since the epoch, from the harness's view.
 * @param {number} t.launchedAt - When the writer was started.
 * @param {number|null} t.reachedLockAt - When its lock-wait marker was seen;
 *   null if it never appeared.
 * @param {boolean} t.markerExpected - Whether this case watches for a marker at all.
 * @param {number} t.releasedAt - When the harness released the lock.
 * @param {number|null} t.exitedAt - When the process was seen to exit; null if
 *   only the kill ended it.
 * @param {number} t.waitMs - How long the harness waited after the release.
 * @returns {string}
 */
export function describeWriterTimeout({ launchedAt, reachedLockAt, markerExpected, releasedAt, exitedAt, waitMs }) {
  if (exitedAt != null && exitedAt - releasedAt <= waitMs) {
    // It can exit while the harness is still waiting for its marker, before the release.
    const when = exitedAt < releasedAt
      ? `${seconds(releasedAt - exitedAt)} before`
      : `${seconds(exitedAt - releasedAt)} after`;
    return `its process exited ${when} the lock release, `
      + `but its output streams were still open ${seconds(waitMs)} after the release`;
  }
  if (markerExpected && reachedLockAt == null) {
    return `it had not reached the lock ${seconds(releasedAt - launchedAt)} after it was started, `
      + `so it was still starting up when the lock was released and its ${seconds(waitMs)} `
      + 'included its own start-up: a starved machine looks like this';
  }
  const reached = reachedLockAt == null ? '' : `it reached the lock ${seconds(reachedLockAt - launchedAt)} after it was started and `;
  return `${reached}it was still running ${seconds(waitMs)} after the lock release`;
}
