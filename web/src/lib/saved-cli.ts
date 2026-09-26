import { keepIfInstalled, pickSoleInstalled } from "./cli-pick.mjs";

export const CONFIG_KEY = "career-ops:config";

export function readSavedCliId(): string | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const id = raw ? JSON.parse(raw).cliId : "";
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export function persistCliId(cliId: string) {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const prev = raw ? JSON.parse(raw) : {};
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ ...prev, mode: prev.mode || "cli", cliId }),
    );
  } catch {
    /* quota / private mode */
  }
}

export { pickDefaultInstalled, pickSoleInstalled } from "./cli-pick.mjs";

// /api/clis is parsed with a type assertion, not runtime-checked, so a bad
// entry (null, a string, {id: 123}) would otherwise reach .some()/filter()
// and either throw or silently pick a CLI with no real id. One malformed
// entry invalidates the whole response — we don't know what else is wrong
// with it, so fall through to the same "can't check" path as a network error.
function isCliEntry(c: unknown): c is { id: string; installed?: boolean } {
  if (typeof c !== "object" || c === null) return false;
  const { id, installed } = c as { id?: unknown; installed?: unknown };
  return typeof id === "string" && id !== "" && (installed === undefined || typeof installed === "boolean");
}

/**
 * Saved Config cliId if it is still installed, otherwise the only installed CLI
 * (and persist that pick). Returns null when neither resolves — the caller then
 * shows the "open Config" message rather than launching a run that 404s.
 *
 * The saved id is validated against /api/clis, not trusted blind: an install
 * swapped from one CLI to another leaves a stale id in localStorage, and
 * `resolveCli()` on the server returns null for it, so every run fails with
 * `CLI '<id>' not found` until Config is reopened (#4012).
 *
 * `onStale` fires when a saved id is dropped for not being installed, with the
 * id that replaced it (or null). The replacement is persisted, so the old value
 * is otherwise gone without a trace — and a transient `installed: false` (a
 * reinstall in flight, a PATH not yet refreshed) is enough to trigger it.
 */
// /api/clis is a synchronous PATH scan — no subprocesses — so this is slack,
// not an estimate.
const CLIS_TIMEOUT_MS = 5000;

export async function resolveCliId(
  onStale?: (stale: string, replacement: string | null) => void,
): Promise<string | null> {
  const saved = readSavedCliId();
  let clis: { id: string; installed?: boolean }[] | undefined;
  try {
    // Bounded: every job start awaits this, so a stalled request would leave
    // the job at "Starting…" instead of reaching the saved-id fallback below.
    const r = await fetch("/api/clis", { signal: AbortSignal.timeout(CLIS_TIMEOUT_MS) });
    if (r.ok) {
      const d = (await r.json()) as { clis?: { id: string; installed?: boolean }[] };
      clis = d.clis;
    }
  } catch {
    // network error or timeout — fall through to the not-an-array guard below
  }
  if (!Array.isArray(clis) || !clis.every(isCliEntry)) {
    // /api/clis unreachable, errored, or malformed — can't check. Trust the
    // saved id rather than stranding a working setup on a transient failure.
    return saved;
  }
  if (keepIfInstalled(saved, clis)) return saved;
  const sole = pickSoleInstalled(clis);
  if (sole) persistCliId(sole);
  if (saved) onStale?.(saved, sole);
  return sole;
}
