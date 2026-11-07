const STATUS_KEY = {
  "1": "Evaluated",
  "2": "Applied",
  "3": "Responded",
  "4": "Interview",
  "5": "Offer",
  "6": "Rejected",
  "7": "Discarded",
  "8": "SKIP",
};

/** @param {{ key?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, typing?: boolean, composing?: boolean, pending?: boolean, repeat?: boolean }} input */
export function trackerCommand(input) {
  // pending: the list is mid-navigation and the rows on screen are the previous tab.
  if (!input || input.typing || input.composing || input.metaKey || input.ctrlKey || input.altKey || input.pending) return null;
  // Arrow keys stay with the browser so the page still scrolls.
  // Holding j or k may repeat. Holding a status key must not set the cursor row after the selection clears.
  if (input.key === "j") return { name: "next" };
  if (input.key === "k") return { name: "prev" };
  if (input.repeat) return null;
  const status = STATUS_KEY[input.key];
  if (status) return { name: "status", status };
  return null;
}

/**
 * Selection after a status save. A row that saved is cleared. A row checked
 * while that save was running stays, because it was not part of the attempt.
 * A failed row stays only when it is still selected. A cursor row that was
 * not selected stays unselected, including when its save fails.
 * Tracker numbers are strings, the same as a row's n.
 * @template {{ n: string }} T
 * @param {string[]} selectedKeys
 * @param {T[]} attempted
 * @param {Set<string>} failedNums
 * @param {(row: T) => string} keyOf
 * @returns {string[]}
 */
export function selectionAfterFailedSave(selectedKeys, attempted, failedNums, keyOf) {
  const saved = new Set();
  for (const row of attempted) {
    if (!failedNums.has(row.n)) saved.add(keyOf(row));
  }
  return selectedKeys.filter((key) => !saved.has(key));
}

export function rangeKeys(keys, anchor, target) {
  const start = keys.indexOf(anchor);
  const end = keys.indexOf(target);
  if (start < 0 || end < 0) return null;
  const [lo, hi] = start < end ? [start, end] : [end, start];
  return keys.slice(lo, hi + 1);
}
