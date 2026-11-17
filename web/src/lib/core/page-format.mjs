import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_PAGE_FORMAT, PAGE_FORMATS } from "../page-formats.mjs";

/**
 * ACL for the core's paper-size owner (lib/page-format.mjs), so a dashboard pdf
 * run prints on the sheet the CLI would.
 *
 * The CLI ranks paper size explicit `--format` -> config/profile.yml
 * `page_format` -> the project default, and `page_format: auto` hands the choice
 * to the employer's country. The web used to tell its agent to pick letter for a
 * US/Canada company and a4 otherwise, whatever the profile said, then passed
 * that pick as `--format`, which outranks the profile. A user with
 * `page_format: a4` could get Letter from the dashboard, and `auto` never
 * applied there.
 *
 * Two steps, because the agent lays the body out (it fills `{{PAGE_WIDTH}}`)
 * before the backend sizes the sheet:
 *
 * 1. readPageFormatSetting(), before the run: the profile's stance, so the
 *    prompt can name the width and, under `auto`, ask the agent for a country.
 * 2. resolveRenderPageFormat(), after it: the sheet to pass to generate-pdf.mjs,
 *    from that same stance plus what the agent declared. The stance is carried
 *    across rather than read again, so a profile edited mid-run cannot leave the
 *    body laid out for one sheet and printed on another.
 *
 * The ranking itself stays the core's: the module is loaded at runtime, as
 * cv-template.mjs loads cv-templates.mjs, because Turbopack's root is pinned to
 * web/ and refuses a static import from outside it. `coreRoot` is an argument for
 * the reasons cv-template.mjs gives.
 *
 * Never throws. A core that cannot be loaded, or that predates
 * readProfilePageSetting, reads as "nothing stated", which is how the web
 * behaved before: the agent picks, and the web's own default backs it up.
 */

const SETTINGS = new Set(["a4", "letter", "auto"]);

async function loadCore(coreRoot) {
  try {
    return await import(/* webpackIgnore: true */ pathToFileURL(path.join(coreRoot, "lib", "page-format.mjs")).href);
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} PageFormatSetting
 * @property {"a4"|"letter"|"auto"|null} setting - The profile's `page_format`,
 *   or null when it states none the core accepts.
 * @property {string[]} letterCountries - The core's Letter countries, sorted, for
 *   the `auto` prompt. Empty unless `setting` is `auto`.
 */

/**
 * @param {string} coreRoot Absolute path to the career-ops code checkout.
 * @param {string} profilePath Absolute path to the user's profile (getProfilePath()).
 * @returns {Promise<PageFormatSetting>}
 */
export async function readPageFormatSetting(coreRoot, profilePath) {
  const none = { setting: null, letterCountries: [] };
  const mod = await loadCore(coreRoot);
  if (typeof mod?.readProfilePageSetting !== "function") return none;
  let setting;
  try {
    setting = mod.readProfilePageSetting(profilePath);
  } catch {
    return none;
  }
  if (!SETTINGS.has(setting)) return none;
  if (setting !== "auto") return { setting, letterCountries: [] };
  const letterCountries = mod.LETTER_COUNTRIES instanceof Set ? [...mod.LETTER_COUNTRIES].sort() : [];
  // A prompt that asks for a country but cannot say which ones mean Letter would
  // leave the body width a guess. Fall back to the agent's own pick instead.
  return letterCountries.length > 0 ? { setting, letterCountries } : none;
}

/**
 * The sheet to render, from the stance read before the run and the agent's
 * envelope.
 *
 * - `a4` / `letter` in the profile wins; a different declared format is reported.
 * - `auto` takes the declared country, ranked by the core's resolvePageFormat.
 * - Nothing stated: the declared format, else the project default.
 *
 * @param {string} coreRoot Absolute path to the career-ops code checkout.
 * @param {{setting?: "a4"|"letter"|"auto"|null, declared?: "a4"|"letter"|null, country?: string|null}} args
 * @returns {Promise<{format: "a4"|"letter", warnings: string[]}>}
 */
export async function resolveRenderPageFormat(coreRoot, { setting = null, declared = null, country = null } = {}) {
  const warnings = [];
  if (setting === "a4" || setting === "letter") {
    if (declared && declared !== setting) {
      warnings.push(`The agent declared ${declared}, but page_format in your profile is ${setting}; rendering ${setting}.`);
    }
    return { format: setting, warnings };
  }
  if (setting === "auto") {
    const mod = await loadCore(coreRoot);
    const known = typeof mod?.pageFormatForCountry === "function" ? mod.pageFormatForCountry(country) : null;
    if (!known) {
      warnings.push(country
        ? `page_format is auto, but "${String(country).slice(0, 16)}" is not a two-letter country code; defaulting to ${DEFAULT_PAGE_FORMAT}.`
        : `page_format is auto, but the agent named no country; defaulting to ${DEFAULT_PAGE_FORMAT}.`);
    }
    const format = typeof mod?.resolvePageFormat === "function"
      ? mod.resolvePageFormat("auto", { country })
      : known ?? DEFAULT_PAGE_FORMAT;
    return { format: PAGE_FORMATS.has(format) ? format : DEFAULT_PAGE_FORMAT, warnings };
  }
  if (declared && PAGE_FORMATS.has(declared)) return { format: declared, warnings };
  warnings.push(`The agent declared no page format; defaulting to ${DEFAULT_PAGE_FORMAT}.`);
  return { format: DEFAULT_PAGE_FORMAT, warnings };
}
