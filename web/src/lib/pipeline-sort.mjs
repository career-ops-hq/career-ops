/**
 * Compare tracker row identifiers as numbers. They arrive from the Markdown
 * tracker as strings, so a plain localeCompare would put #10 before #2.
 *
 * @param {{ n?: string }} a
 * @param {{ n?: string }} b
 */
export function compareTrackerNumbers(a, b) {
  return Number(a?.n) - Number(b?.n);
}
