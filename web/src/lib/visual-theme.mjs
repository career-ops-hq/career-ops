export const VISUAL_THEMES = ["ocean", "classic"];
export const DEFAULT_VISUAL_THEME = "ocean";
export const VISUAL_STORAGE_KEY = "career-ops:visual-theme";

export function isVisualTheme(value) {
  return VISUAL_THEMES.includes(value);
}

export function storedVisualTheme(raw) {
  return isVisualTheme(raw) ? raw : DEFAULT_VISUAL_THEME;
}
