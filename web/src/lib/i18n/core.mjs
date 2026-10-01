// UI localisation core: pure and node-free, so server components, client
// components and `node --test` all load the same rules.
//
// The English source string IS the key (gettext style). A missing translation
// falls back to the English text instead of rendering a raw key, so a string
// added upstream shows up in English until someone translates it, never broken.
// Only UI chrome goes through here: user data (CV, reports, company names) and
// the canonical tracker statuses written to data/applications.md stay as-is.

import { tr } from "./tr.mjs";

export const LOCALES = /** @type {const} */ (["en", "tr"]);
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "career-ops-locale";

/** @type {Record<string, Record<string, string>>} */
const DICTIONARIES = { tr };

/** @param {unknown} value @returns {value is "en" | "tr"} */
export function isLocale(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (LOCALES).includes(value);
}

/** Cookie/env value → a supported locale, else the fallback. */
export function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  if (isLocale(value)) return value;
  if (typeof value === "string") {
    const base = value.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return fallback;
}

/** Replace `{name}` placeholders; unknown placeholders are left visible. */
export function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** Translate one English source string for `locale`. */
export function translate(locale, key, vars) {
  const dict = DICTIONARIES[locale];
  const text = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  return interpolate(text, vars);
}

/**
 * Build the `t` function handed to components.
 *   t("Today")
 *   t("Scanned {n} portals", { n })
 *   t.n(count, "{n} role", "{n} roles")   // English picks singular/plural;
 *                                          // Turkish keys on the plural form.
 */
export function makeT(locale) {
  const t = (key, vars) => translate(locale, key, vars);
  t.n = (count, one, other, vars) => {
    const all = { n: count, ...(vars || {}) };
    if (locale === "en") return interpolate(count === 1 ? one : other, all);
    const dict = DICTIONARIES[locale] || {};
    const text = dict[other] ?? dict[one] ?? (count === 1 ? one : other);
    return interpolate(text, all);
  };
  // Same English word, different meaning (gettext msgctxt): the dictionary key
  // is "context|English"; English and untranslated contexts fall back to key.
  t.ctx = (context, key, vars) => {
    const dict = DICTIONARIES[locale] || {};
    const scoped = `${context}|${key}`;
    if (Object.prototype.hasOwnProperty.call(dict, scoped)) return interpolate(dict[scoped], vars);
    return translate(locale, key, vars);
  };
  t.locale = locale;
  return t;
}

/** BCP-47 tag for Intl date/number formatting. */
export function intlLocale(locale) {
  return locale === "tr" ? "tr-TR" : "en-US";
}
