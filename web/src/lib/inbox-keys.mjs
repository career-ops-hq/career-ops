/** @param {{ key?: string, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, typing?: boolean, composing?: boolean, selected?: number, repeat?: boolean }} input */
export function inboxCommand(input) {
  if (!input || input.typing || input.composing || input.metaKey || input.ctrlKey || input.altKey) return null;
  const key = input.key;
  // Arrow keys stay with the browser so the page still scrolls.
  // Holding j or k may repeat. Holding s or x must not skip or save every row that slides into place.
  if (key === "j") return "next";
  if (key === "k") return "prev";
  if (input.repeat) return null;
  if (key === "s" || key === "S") return "save";
  if ((key === "x" || key === "X") && input.shiftKey && (input.selected ?? 0) > 0) return "skip-selected";
  if (key === "x" || key === "X") return "skip";
  return null;
}

const NOT_TYPING_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset"]);

/**
 * A text field, a select, or anything in a dialog takes the keys. A row
 * checkbox does not: it keeps focus after a click, and Shift+X comes next.
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

/** The removed row left the list. An earlier removal shifts the cursor up. The focused removal stays put, on the row that slid into that slot. */
export function cursorAfterRemoval(index, removedIndex) {
  if (removedIndex < index) return index - 1;
  return index;
}
