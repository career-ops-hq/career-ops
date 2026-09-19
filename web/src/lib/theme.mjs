// Shared theme constants and pure helpers. Keeping this module free of React
// and browser globals lets the bootstrap script, provider, and tests agree on
// the same storage key and browser-chrome colors.

export const THEME_STORAGE_KEY = "career-ops:theme";

export const THEME_COLORS = Object.freeze({
  light: "#f7f6f3",
  dark: "#0a0a0a",
});

/** @param {unknown} value */
export function isTheme(value) {
  return value === "light" || value === "dark";
}

/** @param {unknown} value @param {"light"|"dark"} fallback */
export function storedTheme(value, fallback = "dark") {
  return isTheme(value) ? value : fallback;
}

