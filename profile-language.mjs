import * as yaml from 'js-yaml';

const DEFAULT_OUTPUT_LANGUAGE = 'en';

function normalizeOutputLanguage(value) {
  if (typeof value !== 'string') return DEFAULT_OUTPUT_LANGUAGE;
  const language = value.trim();
  if (!language || language.length > 64 || /[\r\n\0]/.test(language)) {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
  return language;
}

/**
 * language.output, plus WHY that is the answer.
 *
 * The catch below folds three different situations into `en`: no profile, no
 * language key, and a profile that does not parse. The first two are correct —
 * English is the documented default. The third is not something the caller
 * should be unable to distinguish: a user who set `output: ja` and has a YAML
 * typo elsewhere in the file gets every report, cover letter and outreach
 * message in English, and the only signal is noticing the wrong language in
 * finished work.
 *
 * `source` makes that inspectable without changing what any existing caller
 * receives. `doctor.mjs` is the primary signal now (checkProfileShape reports
 * an unparseable profile on the first message of every session); this is for a
 * caller that wants to say so at generation time.
 *
 * @param {string} profileYaml
 * @returns {{language: string, source: 'configured'|'default'|'unparseable'}}
 */
export function describeOutputLanguage(profileYaml) {
  let profile;
  try {
    profile = yaml.load(String(profileYaml ?? '')) || {};
  } catch {
    return { language: DEFAULT_OUTPUT_LANGUAGE, source: 'unparseable' };
  }
  const raw = profile?.language?.output;
  const language = normalizeOutputLanguage(raw);
  // 'configured' only when the file actually asked for what it got — a value
  // that normalizes away (too long, embedded newline) is a default, not a
  // setting the user made.
  const configured = typeof raw === 'string' && raw.trim() === language;
  return { language, source: configured ? 'configured' : 'default' };
}

/**
 * Parse language.output from profile YAML, falling back to English.
 *
 * Contract unchanged — returns the language string. Use describeOutputLanguage
 * when the reason matters.
 */
export function parseOutputLanguage(profileYaml) {
  return describeOutputLanguage(profileYaml).language;
}

/** Build the canonical output-language rule injected into every model prompt. */
export function outputLanguageInstruction(language) {
  const outputLanguage = normalizeOutputLanguage(language);
  return [
    `Write all human-facing output in ${outputLanguage}, including the full A–G`,
    `evaluation and the machine-readable summary's free-text fields, regardless`,
    `of the language of these instructions or the job description. Keep`,
    `market-specific terms when relevant, but explain them in ${outputLanguage}`,
    `when needed. The configured language.output always wins over the job`,
    `description's language.`,
  ].join(' ');
}
