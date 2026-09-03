import { pickDefaultCli } from "./cli-pick.mjs";

export const CONFIG_KEY = "career-ops:config";

export { pickDefaultCli };

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

/**
 * Saved Config cliId, or the default installed CLI (and persist that pick).
 *
 * INVARIANT: whatever this resolves to is what Config renders as selected, and
 * it is always written to storage. A default that is displayed but not stored
 * is the bug this function exists to prevent — Config used to highlight the
 * first installed CLI while every consumer read an empty key, so the page
 * looked configured and jobs failed with "connect your CLI".
 */
export async function resolveCliId(): Promise<string | null> {
  const saved = readSavedCliId();
  if (saved) return saved;
  try {
    const r = await fetch("/api/clis");
    const d = (await r.json()) as { clis?: { id: string; installed?: boolean }[] };
    const fallback = pickDefaultCli(d.clis);
    if (!fallback) return null;
    persistCliId(fallback);
    return fallback;
  } catch {
    return null;
  }
}
