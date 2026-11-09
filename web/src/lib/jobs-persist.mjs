// When the worker job list is written to localStorage.
//
// Every streamed chunk of a running job's output replaces the job list, and the
// provider used to serialize and store up to 40 jobs on each one, so a long
// evaluation rewrote the whole list hundreds of times. The stored copy only has
// to survive a reload, so while a job runs one write per `delayMs` is enough.
// A list with nothing running is written at once, because that is the state a
// reload must not lose (a job just finished or was removed), and `flush()`
// covers a page that goes away mid-stream.

/**
 * @template T
 * @param {object} options
 * @param {(jobs: T[]) => void} options.write - Store the list (the caller handles quota errors).
 * @param {(jobs: T[]) => boolean} options.isActive - True while any job is still running.
 * @param {number} [options.delayMs=1000] - At most one write per this many ms while active.
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: unknown) => void} [options.clearTimer]
 */
export function createJobsPersister({ write, isActive, delayMs = 1000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null; // the latest list not yet written, or null
  let timer = null;

  const writePending = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (pending === null) return;
    const jobs = pending;
    pending = null;
    write(jobs);
  };

  return {
    /** Record the current list; written now if nothing runs, else within delayMs. */
    save(jobs) {
      pending = jobs;
      if (!isActive(jobs)) {
        writePending();
        return;
      }
      if (timer === null) timer = setTimer(writePending, delayMs);
    },
    /** Write whatever is pending now (page hide, unmount). */
    flush: writePending,
  };
}
