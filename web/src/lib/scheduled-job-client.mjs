export const MIN_SCHEDULE_MINUTES = 15;

export function cadenceMinimum(unit) {
  return unit === "minutes" ? MIN_SCHEDULE_MINUTES : 1;
}

export function cadenceValueForUnit(every, unit) {
  const value = Number(every);
  return Number.isFinite(value) ? Math.max(cadenceMinimum(unit), value) : cadenceMinimum(unit);
}

export async function createScheduledJobRequest(payload, fetcher = fetch) {
  const response = await fetcher("/api/scheduled-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not create the scheduled scan.");
  return body;
}

export async function updateScheduledJobRequest(id, payload, fetcher = fetch) {
  const response = await fetcher(`/api/scheduled-jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not update the scheduled scan.");
  return body;
}
