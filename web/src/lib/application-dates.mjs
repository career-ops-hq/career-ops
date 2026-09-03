/**
 * Read the first transition into Applied for every tracker row.
 * The status ledger records event dates; the tracker Date column records evaluation dates.
 *
 * @param {string | null | undefined} tsv data/status-log.tsv content
 * @returns {Map<string, string>} tracker number to YYYY-MM-DD application date
 */
export function parseApplicationDatesFromStatusLog(tsv) {
  const applicationDates = new Map();
  for (const rawLine of String(tsv ?? "").split("\n")) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    const [trackerNumber, eventDate, , toStatus] = rawLine.split("\t").map((cell) => cell.trim());
    if (!/^\d+$/.test(trackerNumber) || !isRealApplicationDate(eventDate)) continue;
    if (toStatus.toLowerCase() !== "applied" || applicationDates.has(trackerNumber)) continue;
    applicationDates.set(trackerNumber, eventDate);
  }
  return applicationDates;
}

/**
 * Resolve an application's submission date without falling back to its evaluation date.
 * The status ledger wins; notes support installations whose status history predates the ledger.
 *
 * @param {{n: string, notes?: string}} application tracker application
 * @param {Map<string, string>} statusLogDates parsed status-ledger dates
 * @returns {string} YYYY-MM-DD or an empty string when the submission date is unknown
 */
export function resolveApplicationAppliedDate(application, statusLogDates) {
  const fromStatusLog = statusLogDates.get(application.n);
  if (fromStatusLog) return fromStatusLog;

  const match = String(application.notes ?? "").match(/\bapplied\s+~?(\d{4}-\d{2}-\d{2})(?![\w-])/i);
  return match && isRealApplicationDate(match[1]) ? match[1] : "";
}

/** True when a value is a real YYYY-MM-DD application date. */
function isRealApplicationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
