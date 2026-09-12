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

/** Saved Config cliId if installed, or the first installed CLI on this machine (and persist that pick). */
export async function resolveCliId(): Promise<string | null> {
  try {
    const r = await fetch("/api/clis");
    const d = (await r.json()) as { clis?: { id: string; installed?: boolean }[] };
    const list = d.clis || [];
    const installed = list.filter((c) => c.installed);
    const saved = readSavedCliId();
    if (saved && installed.some((c) => c.id === saved)) return saved;
    const pick = installed[0]?.id || null;
    if (pick) persistCliId(pick);
    return pick;
  } catch {
    return readSavedCliId();
  }
}
