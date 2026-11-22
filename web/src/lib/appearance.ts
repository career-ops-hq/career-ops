// Appearance settings: a font per role, plus sizes and page width.
// A font is either installed on this machine ("system") or uploaded by the user
// ("upload", kept as a data URL). Applied by overriding CSS variables on <html>.
//
// One shared store (below) holds the current settings for every control, so the
// Config page, the sidebar width button and a pending save can never overwrite
// one another. The source of truth is config/ui-appearance.json (via
// /api/appearance); localStorage is only a cache so the first paint does not flash.
// Edits are blocked until the server copy has loaded, and while it cannot be read,
// so a damaged or unreachable file is never replaced by defaults.
import { normalizeAppearance } from "@/lib/appearance-schema.mjs";

const KEY = "career-ops:appearance";

export type FontChoice = { kind: "system"; family: string } | { kind: "upload"; family: string; data: string };

export const ROLES = [
  { id: "ui", label: "Menu & interface", hint: "Sidebar, buttons, forms and all general text", vars: ["--font-sans"] },
  { id: "heading", label: "Page titles", hint: "Big titles such as “Config” and “Today”", vars: ["--font-display"] },
  { id: "preview", label: "Preview text", hint: "Body text of previewed .md files and reports", vars: ["--font-preview"] },
  { id: "previewHeading", label: "Preview titles", hint: "Headings inside previewed documents", vars: ["--font-preview-heading"] },
  { id: "code", label: "Code", hint: "Code blocks, JSON and monospace text", vars: ["--font-mono"] },
] as const;
export type RoleId = (typeof ROLES)[number]["id"];

export type Appearance = {
  fonts: Partial<Record<RoleId, FontChoice>>;
  uiSize: number; // % of the default root size
  previewSize: number; // % of the default preview text size
  width: "small" | "medium" | "full"; // page content width
};

export const DEFAULTS: Appearance = { fonts: {}, uiSize: 100, previewSize: 100, width: "small" };

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  document.getElementById("user-font-faces")?.remove();
  let faces = "";
  for (const r of ROLES) {
    const f = a.fonts[r.id];
    for (const v of r.vars) {
      if (!f) {
        root.style.removeProperty(v);
        continue;
      }
      // family and data are validated by normalizeAppearance (no quotes, braces or semicolons).
      if (f.kind === "upload") faces += `@font-face{font-family:"${f.family}";src:url("${f.data}");font-display:swap}`;
      const fallback = r.id === "code" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif";
      root.style.setProperty(v, `"${f.family}", ${fallback}`);
    }
  }
  if (faces) {
    const s = document.createElement("style");
    s.id = "user-font-faces";
    s.textContent = faces;
    document.head.appendChild(s);
  }
  root.style.fontSize = a.uiSize === 100 ? "" : `${a.uiSize}%`;
  root.dataset.width = a.width;
  root.style.setProperty("--preview-scale", String(a.previewSize / 100));
}

// ── shared store ────────────────────────────────────────────────────────────

export type AppearanceSnapshot = {
  settings: Appearance;
  /** loading: server copy not read yet · ready: edits allowed · error: file unreadable, edits blocked */
  status: "loading" | "ready" | "error";
  /** What to tell the user for status "error", or when the last save failed. */
  message: string;
};

const INITIAL: AppearanceSnapshot = { settings: DEFAULTS, status: "loading", message: "" };
let snap: AppearanceSnapshot = INITIAL;
const listeners = new Set<() => void>();
let started: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Saves run one after another: an older request can never be written after a newer one.
let saveQueue: Promise<unknown> = Promise.resolve();

function set(next: Partial<AppearanceSnapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getSnapshot = () => snap;
export const getServerSnapshot = () => INITIAL;

function readCache(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(KEY) ?? "null")) as Appearance;
  } catch {
    return DEFAULTS;
  }
}

function writeCache(a: Appearance | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* cache only; a large uploaded font may not fit — the server copy is the truth */
  }
}

/** Load once per page: paint from the cache, then adopt the server copy. */
export function initAppearance(): Promise<void> {
  if (started) return started;
  const cached = readCache();
  applyAppearance(cached);
  set({ settings: cached });
  started = (async () => {
    try {
      const res = await fetch("/api/appearance");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        set({ status: "error", message: body.error || "Your saved appearance settings could not be read." });
        return;
      }
      const raw = await res.json();
      if (raw === null) {
        // The file is confirmed missing (never saved, or deleted to reset): defaults, and drop the stale cache.
        writeCache(null);
        applyAppearance(DEFAULTS);
        set({ settings: DEFAULTS, status: "ready", message: "" });
        return;
      }
      const a = normalizeAppearance(raw) as Appearance;
      writeCache(a);
      applyAppearance(a);
      set({ settings: a, status: "ready", message: "" });
    } catch {
      set({ status: "error", message: "Could not reach the app to load your appearance settings." });
    }
  })();
  return started;
}

/** Change the settings: applied at once, saved after a short pause (sliders fire on every step).
 *  Returns false when edits are blocked (not loaded yet, or the saved file is unreadable). */
export function updateAppearance(change: (current: Appearance) => Appearance): boolean {
  if (snap.status !== "ready") return false;
  const next = normalizeAppearance(change(snap.settings)) as Appearance;
  applyAppearance(next);
  writeCache(next);
  set({ settings: next, message: "" });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveQueue = saveQueue.then(async () => {
      try {
        const res = await fetch("/api/appearance", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(snap.settings), // always the latest, whichever control made the last change
        });
        if (!res.ok) throw new Error("rejected");
      } catch {
        set({ message: "Could not save to your data folder. The setting applies now but will be lost on reload (font file too large?)." });
      }
    });
  }, 400);
  return true;
}

/** Next page width: small, medium, full, then small again. Same store as the Config page. */
export function cycleWidth(): boolean {
  const order = ["small", "medium", "full"] as const;
  return updateAppearance((cur) => ({ ...cur, width: order[(order.indexOf(cur.width) + 1) % 3] }));
}
