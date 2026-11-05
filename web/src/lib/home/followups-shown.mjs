/**
 * Home shows a short due list (the follow-ups API already caps it) and the
 * hero still prints the full due count. The gap between those two numbers is
 * the rest of the queue, which lives on /followups.
 *
 * @param {number} shownCount cards actually rendered
 * @param {number} dueCount overdue + urgent from the cadence metadata
 * @returns {{ shown: number, hidden: number, total: number }}
 */
export function homeFollowupRemainder(shownCount, dueCount) {
  const shown = Math.max(0, Math.trunc(Number(shownCount) || 0));
  const dueRaw = Number(dueCount);
  const due = Number.isFinite(dueRaw) ? Math.max(0, Math.trunc(dueRaw)) : shown;
  const total = Math.max(shown, due);
  return { shown, hidden: total - shown, total };
}
