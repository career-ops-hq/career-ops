// Appearance settings: a font per role, plus sizes and page width.
// A font is either installed on this machine ("system") or uploaded by the user
// ("upload", kept as a data URL). Applied by overriding CSS variables on <html>.
// The source of truth is config/ui-appearance.json (via /api/appearance);
// localStorage is only a cache so the page does not flash before the server answers.
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

export function loadAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(KEY) ?? "null")) as Appearance;
  } catch {
    return DEFAULTS;
  }
}

function cacheAppearance(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* cache only; a large uploaded font may not fit — the server copy still works */
  }
}

/** Save to the server (and the local cache). Resolves false when the server did not accept it. */
export async function saveAppearance(a: Appearance): Promise<boolean> {
  cacheAppearance(a);
  try {
    const res = await fetch("/api/appearance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The saved settings, or null when there are none yet (or the server could not be reached). */
export async function loadAppearanceFromServer(): Promise<Appearance | null> {
  try {
    const res = await fetch("/api/appearance");
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw) return null;
    const a = normalizeAppearance(raw) as Appearance;
    cacheAppearance(a);
    return a;
  } catch {
    return null;
  }
}

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
