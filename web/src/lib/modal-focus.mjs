export function cycleFocusIndex(index, count, backwards = false) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (backwards) return index <= 0 ? count - 1 : index - 1;
  return index >= count - 1 ? 0 : index + 1;
}

// Chrome moves Tab between the parts of these fields. Cancelling that Tab
// skips the rest of the field.
const SEGMENTED_TAB = new Set(["date", "time", "datetime-local", "month", "week"]);

export function tabMovesInsideControl(element) {
  if (!element || element.disabled || element.tagName !== "INPUT") return false;
  return SEGMENTED_TAB.has(element.type);
}

/**
 * Where to put focus after Tab leaves a segmented field.
 * -1 means the browser already left focus in the right place.
 *
 * @param {{ stayedOnControl: boolean, stillInside: boolean, count: number, backwards?: boolean }} move
 * @returns {number}
 */
export function recoverFocusIndex({ stayedOnControl, stillInside, count, backwards = false }) {
  if (stayedOnControl || stillInside || !Number.isInteger(count) || count <= 0) return -1;
  return backwards ? count - 1 : 0;
}
