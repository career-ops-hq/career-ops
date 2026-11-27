/**
 * run-slots.mjs — cap how many heavy AI runs the dashboard starts at once.
 *
 * "Score shortlist" calls startJob() once per shortlisted role, and every call
 * POSTed /api/run immediately, so N roles started N AI CLI processes together.
 * On a subscription CLI with a usage window, a 15-role shortlist can spend the
 * window in minutes, and every run still in flight then fails mid-report; it
 * also spikes local load, since each run can launch a browser for its PDF.
 *
 * Heavy kinds (evaluate, pdf) now take a slot first: at most `limit` run at
 * once and the rest wait in FIFO order, starting as slots free. Other kinds
 * never wait. Same spirit as modes/_shared.md → "Subagent delegation (cost
 * guardrail)": one click must not fan out into an unbounded swarm.
 *
 * The limit defaults to 3 and can be changed per browser through the
 * localStorage key below (1–20).
 */

export const HEAVY_RUN_KINDS = new Set(["evaluate", "pdf"]);
export const DEFAULT_MAX_PARALLEL_RUNS = 3;
export const MAX_PARALLEL_RUNS_KEY = "career-ops:max-parallel-runs";

/** @param {unknown} raw @returns {number} */
export function parseMaxParallelRuns(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : DEFAULT_MAX_PARALLEL_RUNS;
}

/**
 * @param {() => number} getLimit Read on every scheduling decision, so a changed setting applies to the queue.
 */
export function createRunSlots(getLimit) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  function pump() {
    while (active < getLimit() && queue.length) {
      active++;
      /** @type {() => void} */ (queue.shift())();
    }
  }

  return {
    /**
     * Resolves with release() once a slot is free. release() is idempotent.
     * @param {string} kind
     * @param {(position: number) => void} [onQueued] Called once, with the 1-based queue position, when the run has to wait.
     * @returns {Promise<() => void>}
     */
    acquire(kind, onQueued) {
      if (!HEAVY_RUN_KINDS.has(kind)) return Promise.resolve(() => {});
      return new Promise((resolve) => {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          active = Math.max(0, active - 1);
          pump();
        };
        queue.push(() => resolve(release));
        if (active >= getLimit()) onQueued?.(queue.length);
        pump();
      });
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
