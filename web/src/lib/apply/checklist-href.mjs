/**
 * Tracker and report ids are digits. Anything else is omitted so the checklist
 * link cannot carry a path.
 *
 * @param {unknown} applicationNumber
 * @returns {string | null}
 */
export function checklistHrefFor(applicationNumber) {
  const id = typeof applicationNumber === "string" || typeof applicationNumber === "number" ? String(applicationNumber).trim() : "";
  if (!/^\d+$/.test(id)) return null;
  return `/pipeline/${id}/apply`;
}
