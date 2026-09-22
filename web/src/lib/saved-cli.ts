import { pickSoleInstalled } from "./cli-pick.mjs";

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

/** Saved Config cliId, or the only installed CLI (and persist that pick). */
export async function resolveCliId(): Promise<string | null> {
  const saved = readSavedCliId();
  if (saved) return saved;
  try {
    const r = await fetch("/api/clis");
    const d = (await r.json()) as { clis?: { id: string; installed?: boolean }[] };
    const sole = pickSoleInstalled(d.clis);
    if (!sole) return null;
    persistCliId(sole);
    return sole;
  } catch {
    return null;
  }
}
