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
 */
import { existsSync, readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

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
 * Read the standing preference out of a profile file.
 *
 * Best-effort, matching `readStyleTokens` in theme-style.mjs: config/profile.yml
 * is a USER-LAYER file the renderers consult for preferences, so a missing file,
 * malformed YAML or an unrecognized value all mean "nothing stated". A typo
 * there must never fail a render.
 *
 * @param {string} [profilePath]
 * @returns {'a4'|'letter'|null}
 */
export function readProfilePageFormat(profilePath = 'config/profile.yml') {
  try {
    if (!existsSync(profilePath)) return null;
    const doc = yaml.load(readFileSync(profilePath, 'utf-8'));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return normalizePageFormat(doc[PROFILE_PAGE_FORMAT_KEY]);
  } catch {
    return null;
  }
}

/**
 * Rank an explicit choice, the user's profile and the project default.
 *
 * @param {unknown} [explicit] - A `--format` flag or a payload's `page_format`.
 * @param {{profilePath?: string}} [opts]
 * @returns {'a4'|'letter'}
 */
export function resolvePageFormat(explicit, { profilePath } = {}) {
  return (
    normalizePageFormat(explicit) ??
    readProfilePageFormat(profilePath) ??
    DEFAULT_PAGE_FORMAT
  );
}
