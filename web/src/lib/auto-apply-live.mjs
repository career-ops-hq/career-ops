export function parseLiveLog(text) {
  const events = [];
  // This is an append-only event log, so malformed/truncated lines are safe to skip.
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const event = JSON.parse(line); if (event && typeof event === "object" && !Array.isArray(event)) events.push(event); } catch { /* ignore a damaged log line */ }
  }
  return events;
}

// Queued postings still awaiting a decision. A skipped posting leaves the queue at once.
export function openQueue(events, decisions) {
  const skipped = new Set(decisions.filter(item => item.decision === "skip").map(item => item.url));
  return [...new Map(events.filter(event => event.type === "queue" && event.url && !skipped.has(event.url)).map(event => [event.url, event])).values()];
}

export function deriveStatus(events, nowMs = Date.now()) {
  if (!events.length) return { state: "never", lastEvent: null, runStartedAt: null, counts: { submitted: 0, queued: 0, skipped: 0 } };
  let started = null;
  let ended = false;
  let counts = { submitted: 0, queued: 0, skipped: 0 };
  for (const event of events) {
    if (event.type === "run_start") { started = event.ts ?? null; ended = false; }
    if (event.type === "run_end") { ended = true; counts = { submitted: Number(event.submitted) || 0, queued: Number(event.queued) || 0, skipped: Number(event.skipped) || 0 }; }
  }
  const lastEvent = events.at(-1);
  const recent = Number.isFinite(Date.parse(lastEvent.ts)) && nowMs - Date.parse(lastEvent.ts) <= 120_000 && nowMs >= Date.parse(lastEvent.ts);
  return { state: started && !ended && recent ? "running" : "idle", lastEvent, runStartedAt: started, counts };
}
