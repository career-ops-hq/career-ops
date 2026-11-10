// Validation + file helpers for the two small user-state files the web UI keeps
// in the data folder: config/ui-appearance.json and data/prep-progress.json.
// Plain .mjs so node --test can import it (see tests/lib/ui-state.test.mjs).
import fs from "node:fs";
import path from "node:path";

export const ROLE_IDS = ["ui", "heading", "preview", "previewHeading", "code"];
export const WIDTHS = ["small", "medium", "full"];
export const DEFAULT_APPEARANCE = { fonts: {}, uiSize: 100, previewSize: 100, width: "small" };

// System font names go into a quoted CSS string, so only plain name characters
// are allowed (no quotes, backslashes, semicolons, braces).
const FAMILY_RE = /^[\p{L}\p{N} .,&'()+_-]{1,80}$/u;
const DATA_URL_RE = /^data:[\w/.+-]{0,60};base64,[A-Za-z0-9+/=]+$/;
const MAX_FONT_DATA = 8 * 1024 * 1024;

const num = (v, min, max, dflt) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt);

/** Coerce untrusted JSON into a safe Appearance. Never throws. */
export function normalizeAppearance(raw) {
  const out = { fonts: {}, uiSize: 100, previewSize: 100, width: "small" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  out.uiSize = num(raw.uiSize, 80, 140, 100);
  out.previewSize = num(raw.previewSize, 80, 160, 100);
  out.width = WIDTHS.includes(raw.width) ? raw.width : "small";
  const fonts = raw.fonts && typeof raw.fonts === "object" ? raw.fonts : {};
  for (const id of ROLE_IDS) {
    const f = fonts[id];
    if (!f || typeof f !== "object") continue;
    if (f.kind === "system" && typeof f.family === "string" && FAMILY_RE.test(f.family)) {
      out.fonts[id] = { kind: "system", family: f.family };
    } else if (f.kind === "upload" && typeof f.data === "string" && f.data.length <= MAX_FONT_DATA && DATA_URL_RE.test(f.data)) {
      out.fonts[id] = { kind: "upload", family: `UserFont-${id}`, data: f.data };
    }
  }
  return out;
}

/** Coerce untrusted JSON into { ticks, tasks }. Never throws. */
export function normalizeProgress(raw) {
  const out = { ticks: {}, tasks: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (raw.ticks && typeof raw.ticks === "object" && !Array.isArray(raw.ticks)) {
    for (const [k, v] of Object.entries(raw.ticks).slice(0, 5000)) if (typeof v === "boolean") out.ticks[k] = v;
  }
  if (raw.tasks && typeof raw.tasks === "object" && !Array.isArray(raw.tasks)) {
    for (const [company, list] of Object.entries(raw.tasks).slice(0, 500)) {
      if (!Array.isArray(list)) continue;
      out.tasks[company] = list
        .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
        .slice(0, 200)
        .map((t) => ({ id: t.id.slice(0, 40), text: t.text.slice(0, 300), done: t.done === true }));
    }
  }
  return out;
}

/** Read a JSON file. Missing file -> `fallback`; any other failure (permission,
 *  broken JSON) throws, so a damaged user file is surfaced, not silently replaced. */
export function readJsonFile(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return fallback;
    throw error;
  }
  return JSON.parse(text);
}

/** Write JSON via a temp file + rename, so a crash never leaves truncated JSON. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
