import * as yaml from 'js-yaml';

/**
 * True when `text` holds anything besides blank lines and comments.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasYamlContent(text) {
  return String(text ?? '').split('\n').some((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('#');
  });
}

/**
 * Parse one YAML document. Empty and comment-only text is an empty document
 * and yields null, as it did on js-yaml 4; js-yaml 5 throws on it instead.
 * Malformed YAML still throws.
 *
 * @param {string} text
 * @param {import('js-yaml').LoadOptions} [options]
 * @returns {unknown}
 */
export function loadYaml(text, options) {
  return hasYamlContent(text) ? yaml.load(String(text), options) : null;
}
