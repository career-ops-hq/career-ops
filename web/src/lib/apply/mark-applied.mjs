const READING = new Set(["opening", "driving"]);
const READY = new Set(["ready", "prefilling", "filling", "done"]);

/**
 * @param {{ status?: string, issues?: { code?: string, level?: string }[] }} [input]
 * @returns {{ enabled: boolean, reason: "reading" | "error" | "idle" | "ready", hint: string }}
 */
export function markAppliedEnabled({ status, issues } = {}) {
  if (READING.has(status)) {
    return { enabled: false, reason: "reading", hint: "Available after the form finishes loading." };
  }
  const blocked = Array.isArray(issues) && issues.some((issue) => issue && (issue.code === "not-found" || issue.level === "block"));
  if (status === "error" || blocked) {
    return { enabled: false, reason: "error", hint: "This form did not load, so it cannot be marked applied." };
  }
  if (!READY.has(status)) {
    return { enabled: false, reason: "idle", hint: "Open a form before marking it applied." };
  }
  return { enabled: true, reason: "ready", hint: "Click this once you have submitted the real form yourself." };
}
