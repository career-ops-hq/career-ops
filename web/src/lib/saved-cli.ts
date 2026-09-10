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

export function pickSoleInstalled(
  clis: { id: string; installed?: boolean }[] | undefined,
): string | null {
  const installed = (clis || []).filter((c) => c.installed);
  return installed.length === 1 ? installed[0].id : null;
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
 */
export async function resolveCliId(): Promise<string | null> {
  const saved = readSavedCliId();
  let clis: { id: string; installed?: boolean }[] | undefined;
  try {
    const r = await fetch("/api/clis");
    if (r.ok) {
      const d = (await r.json()) as { clis?: { id: string; installed?: boolean }[] };
      clis = d.clis;
    }
  } catch {
    // network error — fall through to the not-an-array guard below
  }
  if (!Array.isArray(clis)) {
    // /api/clis unreachable, errored, or malformed — can't check. Trust the
    // saved id rather than stranding a working setup on a transient failure.
    return saved;
  }
  if (saved && clis.some((c) => c.id === saved && c.installed)) {
    return saved;
  }
  const sole = pickSoleInstalled(clis);
  if (!sole) return null;
  persistCliId(sole);
  return sole;
}
