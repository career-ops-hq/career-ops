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

/** @param {{ key?: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, typing?: boolean, composing?: boolean, pending?: boolean }} input */
export function trackerCommand(input) {
  // pending: the list is mid-navigation and the rows on screen are the previous tab.
  if (!input || input.typing || input.composing || input.metaKey || input.ctrlKey || input.altKey || input.pending) return null;
  // Arrow keys stay with the browser so the page still scrolls.
  if (input.key === "j") return { name: "next" };
  if (input.key === "k") return { name: "prev" };
  const status = STATUS_KEY[input.key];
  if (status) return { name: "status", status };
  return null;
}

const NOT_TYPING_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset"]);

/**
 * A text field, a select, or anything in a dialog takes the keys. A row
 * checkbox does not: it keeps focus after a click, and the status key comes next.
 * @param {{ tagName?: string, type?: string, isContentEditable?: boolean, closestDialog?: boolean } | null | undefined} target
 */
export function typingFromTarget(target) {
  if (!target) return false;
  if (target.closestDialog) return true;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "INPUT") return !NOT_TYPING_INPUTS.has(String(target.type || "text").toLowerCase());
  return tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

export function moveCursor(index, count, delta) {
  if (count <= 0) return -1;
  const start = index < 0 ? (delta < 0 ? count - 1 : 0) : index + delta;
  return Math.max(0, Math.min(count - 1, start));
}

/**
 * Selection after a status save. Keep a selected row only when that save failed.
 * A cursor row that was not selected stays unselected, including when its save fails.
 * @param {string[]} selectedKeys
 * @param {{ n: number }[]} attempted
 * @param {Set<number>} failedNums
 * @param {(row: { n: number }) => string} keyOf
 * @returns {string[]}
 */
export function selectionAfterFailedSave(selectedKeys, attempted, failedNums, keyOf) {
  const failed = new Set();
  for (const row of attempted) {
    if (failedNums.has(row.n)) failed.add(keyOf(row));
  }
  return selectedKeys.filter((key) => failed.has(key));
}

export function rangeKeys(keys, anchor, target) {
  const start = keys.indexOf(anchor);
  const end = keys.indexOf(target);
  if (start < 0 || end < 0) return null;
  const [lo, hi] = start < end ? [start, end] : [end, start];
  return keys.slice(lo, hi + 1);
}
