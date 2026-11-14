// Pure validation for the appearance settings (config/ui-appearance.json). No Node
// imports: the browser and the API route share it. Untrusted JSON in, safe values out.

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
