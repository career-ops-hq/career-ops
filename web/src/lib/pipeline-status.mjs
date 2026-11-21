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

/** @typedef {{ recorded: boolean, company?: string, until?: string, scope?: string, reason?: string, error?: string }} CooldownOutcome */

/** The existing status endpoint is the only writer. A 200 alone is not a save.
 * `cooldown` asks the endpoint to record a re-apply cooldown with a Rejected
 * save; its outcome goes to `onCooldown`, since a cooldown that did not land
 * never un-saves the status.
 * @param {string} n
 * @param {string} current
 * @param {string} next
 * @param {typeof fetch} [request]
 * @param {{ days: number, scope?: "role" | "company", onCooldown?: (outcome: CooldownOutcome | null) => void } | null} [cooldown]
 * @returns {Promise<string | null>}
 */
export async function saveStatus(n, current, next, request = fetch, cooldown = null) {
  if (next === current) return null;
  const response = await request("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      n,
      status: next,
      ...(cooldown ? { cooldownDays: cooldown.days, ...(cooldown.scope ? { cooldownScope: cooldown.scope } : {}) } : {}),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "Could not save status. Please try again.");
  }
  // Inputs come from the canonical dropdown; the endpoint echoes that label.
  if (result?.ok !== true || result.status !== next) {
    throw new Error("Could not confirm the saved status. Refresh before trying again.");
  }
  if (cooldown?.onCooldown) {
    cooldown.onCooldown(result.cooldown && typeof result.cooldown === "object" ? result.cooldown : null);
  }
  return result.status;
}

/** One line for the outcome of a requested cooldown, for the status editor.
 * @param {CooldownOutcome | null} outcome
 * @returns {{ ok: boolean, text: string } | null}
 */
export function cooldownMessage(outcome) {
  if (!outcome) return { ok: false, text: "Cooldown not confirmed. Check re_apply_windows in config/profile.yml." };
  if (outcome.recorded && outcome.until) {
    return { ok: true, text: `Cooldown recorded: eligible again ${outcome.until}${outcome.scope === "company" ? " (all roles)" : ""}` };
  }
  if (outcome.reason === "no-cooldown") return null;
  return { ok: false, text: `Cooldown not recorded${outcome.error ? `: ${outcome.error}` : outcome.reason ? ` (${outcome.reason})` : ""}` };
}

/** Take back the row's last logged status change. Resolves to the restored status.
 * @param {string} n
 * @param {typeof fetch} [request]
 * @returns {Promise<string>}
 */
export async function undoStatus(n, request = fetch) {
  const response = await request("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n, undo: true }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "Could not undo. Please try again.");
  }
  if (result?.ok !== true || typeof result.status !== "string") {
    throw new Error("Could not confirm the undo. Refresh before trying again.");
  }
  return result.status;
}

/** One status for many rows. Saves run one at a time, because each save takes
 * the tracker lock and parallel saves would only queue on it or time out.
 * A failed row does not stop the rest.
 * @param {{n: string, status: string}[]} rows
 * @param {string} next
 * @param {typeof fetch} [request]
 * @returns {Promise<{saved: string[], failed: {n: string, error: string}[]}>}
 */
export async function saveStatuses(rows, next, request = fetch) {
  const saved = [];
  const failed = [];
  for (const row of rows) {
    try {
      if (await saveStatus(row.n, row.status, next, request)) saved.push(row.n);
    } catch (e) {
      failed.push({ n: row.n, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { saved, failed };
}
