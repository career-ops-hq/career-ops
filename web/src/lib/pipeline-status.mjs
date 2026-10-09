/** Stable across status changes, sorting and filtering; not just a row position.
 * @param {{n: string, company: string, role: string, date: string, report: string}} row
 */
export function applicationKey(row) {
  return JSON.stringify([row.n, row.company, row.role, row.date, row.report]);
}

/** Replay only a confirmed save while the refreshed server snapshot is pending.
 * A reused tracker number must not inherit another application's status.
 * @template {{n: string, company: string, role: string, date: string, report: string, status: string}} T
 * @param {T[]} rows
 * @param {{key: string, status: string}} saved
 * @returns {T[]}
 */
export function applySavedStatus(rows, saved) {
  return rows.map((row) => applicationKey(row) === saved.key ? { ...row, status: saved.status } : row);
}

/** The existing status endpoint is the only writer. A 200 alone is not a save.
 * @param {string} n
 * @param {string} current
 * @param {string} next
 * @param {typeof fetch} [request]
 * @returns {Promise<string | null>}
 */
export async function saveStatus(n, current, next, request = fetch) {
  if (next === current) return null;
  const response = await request("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n, status: next }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "Could not save status. Please try again.");
  }
  // Inputs come from the canonical dropdown; the endpoint echoes that label.
  if (result?.ok !== true || result.status !== next) {
    throw new Error("Could not confirm the saved status. Refresh before trying again.");
  }
  return result.status;
}
