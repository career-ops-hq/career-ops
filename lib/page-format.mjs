/**
 * page-format.mjs — one owner for paper size.
 *
 * The accepted values, the project default, the body width each one implies, the
 * CSS `@page size` keyword each one maps to, and the rule that ranks the ways a
 * format can be chosen. One owner, so the answer cannot depend on which script
 * the document came through.
 *
 * It used to. `build-cv-html.mjs` fell back to letter's `8.5in` body width while
 * `generate-pdf.mjs` fell back to `a4` in three places and
 * `generate-cover-letter.mjs` in a fourth. A payload declaring
 * `page_format: "letter"` was therefore laid out 8.5in wide and printed onto a
 * 210mm sheet, and modes/pdf.md had to tell the user to "Pass the SAME value" to
 * two scripts by hand. Page size is not in the filename and the PDF opens fine
 * either way, so a mismatched CV reaches a recruiter unnoticed.
 *
 * Resolution order, one direction:
 *
 *   explicit --format / payload page_format
 *     -> config/profile.yml `page_format`
 *       -> DEFAULT_PAGE_FORMAT
 *
 * A user states the size once in their profile instead of remembering a flag on
 * every render.
 *
 * `auto` is a third thing a user can state, not a third sheet. It defers the
 * choice to the employer's country (see `pageFormatForCountry`), and it is opt-in:
 * nobody who has not written it gets a different size.
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadYaml } from './yaml-document.mjs';

/** Accepted `--format` / `page_format` values. */
export const PAGE_FORMATS = new Set(['a4', 'letter']);

/**
 * The size rendered when nobody has stated a preference.
 *
 * `letter`, because that is the contract the project already documents:
 * modes/pdf.md's payload table says `page_format` "Defaults to `letter`",
 * `build-cv-html.mjs` laid its body out that way, and the web's envelope parser
 * picked the same value for the same reason (#2185). The three `a4` fallbacks in
 * the PDF renderers were the outliers, and they are what produced the mismatch.
 */
export const DEFAULT_PAGE_FORMAT = 'letter';

/** The `config/profile.yml` key holding the user's standing preference. */
export const PROFILE_PAGE_FORMAT_KEY = 'page_format';

/**
 * Body width per format, for the HTML the CV template lays out.
 *
 * Lives here beside the `@page` keyword because the two must agree: the template
 * sizes the document body and the print rule sizes the sheet, and a mismatch
 * renders content laid out for one paper size onto another.
 */
export const PAGE_WIDTHS = { a4: '210mm', letter: '8.5in' };

/** CSS `@page { size: … }` keyword per format. */
export const PAGE_CSS_SIZE = { a4: 'A4', letter: 'Letter' };

/** The `page_format` value that defers the sheet to the employer's country. */
export const AUTO_PAGE_FORMAT = 'auto';

/**
 * Countries whose primary paper size is US Letter, as ISO 3166-1 alpha-2 codes:
 * Belize, Canada, Chile, Colombia, Costa Rica, Guatemala, Mexico, Nicaragua,
 * Panama, the Philippines, Puerto Rico, El Salvador, the United States, Venezuela.
 *
 * Source: Unicode CLDR, common/supplemental/supplementalData.xml, the
 * `<paperSize type="US-Letter">` element under `<measurementData>` (read at
 * unicode-org/cldr 86be3214). Its other element, `<paperSize type="A4"
 * territories="001">`, makes A4 the answer for every territory not listed here.
 * Edit this set only to follow a CLDR change.
 */
export const LETTER_COUNTRIES = new Set([
  'BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE',
]);

/**
 * Canonicalize one candidate value, or reject it.
 *
 * Case and surrounding whitespace are forgiven ("A4", " Letter ") because these
 * values arrive from a CLI flag, a YAML file and a JSON payload, three places a
 * person types them by hand. Anything else is null, so each caller decides
 * whether an unrecognized value is a hard error (the `--format` flag, which
 * fails loudly) or a fall-through to the next tier.
 *
 * @param {unknown} value
 * @returns {'a4'|'letter'|null}
 */
export function normalizePageFormat(value) {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return PAGE_FORMATS.has(lower) ? lower : null;
}

/**
 * Map an employer's country to a sheet.
 *
 * @param {unknown} country - An ISO 3166-1 alpha-2 code; case and padding forgiven.
 * @returns {'a4'|'letter'|null} null when the value is not a two-letter code, so
 *   the caller falls back to the project default rather than guessing a sheet.
 */
export function pageFormatForCountry(country) {
  if (typeof country !== 'string') return null;
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return LETTER_COUNTRIES.has(code) ? 'letter' : 'a4';
}

/** True when a candidate value is `auto`, in any casing and padding. */
function isAuto(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === AUTO_PAGE_FORMAT;
}

/**
 * Read the standing preference out of a profile file.
 *
 * Best-effort, matching `readStyleTokens` in theme-style.mjs: config/profile.yml
 * is a USER-LAYER file the renderers consult for preferences, so a missing file,
 * malformed YAML or an unrecognized value all mean "nothing stated". A typo
 * there must never fail a render.
 *
 * `profilePath` carries no default on purpose. A relative one would resolve
 * against the caller's cwd, and the renderers anchor the profile to the tracker
 * workspace or the data root, so a cwd-relative fallback would quietly read a
 * different user's file. Callers pass the anchored path they already build.
 *
 * @param {string} [profilePath]
 * @returns {'a4'|'letter'|null}
 */
export function readProfilePageFormat(profilePath) {
  const setting = readProfileSetting(profilePath);
  return isAuto(setting) ? null : normalizePageFormat(setting);
}

/** The raw `page_format` value in the profile, or undefined when unreadable. */
function readProfileSetting(profilePath) {
  try {
    if (!profilePath || !existsSync(profilePath)) return undefined;
    const doc = loadYaml(readFileSync(profilePath, 'utf-8'));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
    return doc[PROFILE_PAGE_FORMAT_KEY];
  } catch {
    return undefined;
  }
}

/**
 * Rank an explicit choice, the user's profile and the project default.
 *
 * `auto` in either of the first two tiers hands the choice to `country`. An
 * explicit sheet still outranks a profile that says `auto`, and a country is
 * ignored unless `auto` is what won. A missing or malformed country under
 * `auto` takes the project default.
 *
 * @param {unknown} [explicit] - A `--format` flag or a payload's `page_format`.
 * @param {{profilePath?: string, country?: unknown}} [opts] - `country` is the
 *   employer's ISO 3166-1 alpha-2 code.
 * @returns {'a4'|'letter'}
 */
export function resolvePageFormat(explicit, { profilePath, country } = {}) {
  const sheet = normalizePageFormat(explicit);
  if (sheet) return sheet;
  const setting = isAuto(explicit) ? explicit : readProfileSetting(profilePath);
  if (isAuto(setting)) return pageFormatForCountry(country) ?? DEFAULT_PAGE_FORMAT;
  return normalizePageFormat(setting) ?? DEFAULT_PAGE_FORMAT;
}
