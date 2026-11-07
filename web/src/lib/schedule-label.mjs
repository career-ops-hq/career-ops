// Words on the Scheduled scans page. The stored cadence stays
// `{ every, unit }`. This is only how that pair is said.

export const SCHEDULED_SCANS_INTRO =
  "Checks job boards on a schedule and adds new roles to your pipeline.";

export const EMPTY_SCHEDULES_HINT = "Add a schedule to check job boards for new roles.";

/**
 * @param {string} engine "full" checks public boards. Anything else checks saved companies.
 */
export function scanEngineLabel(engine) {
  return engine === "full" ? "All job boards" : "Saved companies";
}

/**
 * @param {string} engine
 */
export function scanEngineDetail(engine) {
  return engine === "full"
    ? "Checks public job boards (Greenhouse, Lever, Ashby, Workday)."
    : "Checks the companies you saved.";
}

/**
 * @param {number | string} every
 * @param {string} unit minutes, hours, or days
 * @returns {string}
 */
export function scheduleCadenceLabel(every, unit) {
  const count = Number(every);
  const name = String(unit ?? "").toLowerCase().replace(/s$/, "");
  if (!Number.isFinite(count) || count <= 0 || !name) return "On a schedule";
  if (name === "minute") return count === 1 ? "Every minute" : `Every ${count} minutes`;
  if (name === "hour") {
    if (count === 1) return "Hourly";
    if (count === 24) return "Daily";
    return `Every ${count} hours`;
  }
  if (name === "day") {
    if (count === 1) return "Daily";
    if (count === 7) return "Weekly";
    if (count === 14) return "Every 2 weeks";
    return `Every ${count} days`;
  }
  if (name === "week") return count === 1 ? "Weekly" : `Every ${count} weeks`;
  return `Every ${count} ${name}${count === 1 ? "" : "s"}`;
}
