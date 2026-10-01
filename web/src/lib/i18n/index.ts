// Typed facade over core.mjs for the TypeScript side of the app.
import {
  LOCALES as CORE_LOCALES,
  DEFAULT_LOCALE as CORE_DEFAULT,
  LOCALE_COOKIE as CORE_COOKIE,
  isLocale as coreIsLocale,
  normalizeLocale as coreNormalize,
  makeT as coreMakeT,
  intlLocale as coreIntlLocale,
  interpolate as coreInterpolate,
} from "./core.mjs";

export type Locale = "en" | "tr";
export type Vars = Record<string, string | number>;

export type T = ((key: string, vars?: Vars) => string) & {
  n: (count: number, one: string, other: string, vars?: Vars) => string;
  ctx: (context: string, key: string, vars?: Vars) => string;
  locale: Locale;
};

export const LOCALES = CORE_LOCALES as readonly Locale[];
export const DEFAULT_LOCALE = CORE_DEFAULT as Locale;
export const LOCALE_COOKIE = CORE_COOKIE as string;

export const isLocale = coreIsLocale as (value: unknown) => value is Locale;
export const normalizeLocale = coreNormalize as (value: unknown, fallback?: Locale) => Locale;
export const makeT = coreMakeT as (locale: Locale) => T;
export const intlLocale = coreIntlLocale as (locale: Locale) => string;
export const interpolate = coreInterpolate as (text: string, vars?: Vars) => string;
