// A pipeline row can unmount while its status save is still running. The
// editor's own error state goes with it, so the page keeps the pending save
// and any failure here until that row is mounted again.

/**
 * @typedef {{ phase: "pending", status: string, n: string } | { phase: "failed", error: string, n: string }} HeldStatusSave
 * @typedef {{ type: "start", key: string, status: string, n: string } | { type: "fail", key: string, error: string, n: string } | { type: "clear", key: string }} HeldStatusSaveEvent
 */

/** @param {ReadonlyMap<string, HeldStatusSave>} holds @param {HeldStatusSaveEvent} event */
export function reduceHeldSave(holds, event) {
  if (event.type === "clear") {
    if (!holds.has(event.key)) return holds;
    const next = new Map(holds);
    next.delete(event.key);
    return next;
  }
  if (event.type === "start") {
    const prev = holds.get(event.key);
    if (prev?.phase === "pending" && prev.status === event.status && prev.n === event.n) return holds;
    const next = new Map(holds);
    next.set(event.key, { phase: "pending", status: event.status, n: event.n });
    return next;
  }
  if (event.type === "fail") {
    const prev = holds.get(event.key);
    if (prev?.phase === "failed" && prev.error === event.error && prev.n === event.n) return holds;
    const next = new Map(holds);
    next.set(event.key, { phase: "failed", error: event.error, n: event.n });
    return next;
  }
  return holds;
}

/** Drop settled holds for the given keys, such as a failure a bulk save replaced.
 * A pending hold stays. That save has not settled, and dropping it lets another
 * write start before this one finishes.
 * @param {ReadonlyMap<string, HeldStatusSave>} holds
 * @param {Iterable<string>} keys
 */
export function clearHeldSaves(holds, keys) {
  let next = holds;
  for (const key of keys) {
    if (next.get(key)?.phase === "pending") continue;
    next = reduceHeldSave(next, { type: "clear", key });
  }
  return next;
}

/** Rows a bulk status write may include. A row still saving is left out so the
 * two writes cannot overlap.
 * @template T
 * @param {readonly T[]} rows
 * @param {ReadonlyMap<string, HeldStatusSave>} holds
 * @param {(row: T) => string} keyOf
 * @returns {{ write: T[], inFlight: T[] }}
 */
export function excludeInFlightStatusRows(rows, holds, keyOf) {
  const write = [];
  const inFlight = [];
  for (const row of rows) {
    if (holds.get(keyOf(row))?.phase === "pending") inFlight.push(row);
    else write.push(row);
  }
  return { write, inFlight };
}

/** Failures for rows that are not currently mounted. The mounted row shows its own alert.
 * @param {ReadonlyMap<string, HeldStatusSave>} holds
 * @param {Iterable<string>} mountedKeys
 * @returns {{ key: string, n: string, error: string }[]}
 */
export function offscreenStatusFailures(holds, mountedKeys) {
  const visible = new Set(mountedKeys);
  const failures = [];
  for (const [key, hold] of holds) {
    if (hold.phase === "failed" && !visible.has(key)) {
      failures.push({ key, n: hold.n, error: hold.error });
    }
  }
  return failures;
}
