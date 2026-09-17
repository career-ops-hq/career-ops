/**
 * jsonc-parse.mjs — JSON.parse for config files written in JSONC.
 *
 * OpenCode accepts JSONC for its project config (`opencode.jsonc`): `//` and
 * comments, plus trailing commas before a closing brace or bracket. Feeding
 * that to `JSON.parse` throws, and doctor.mjs read the throw as "the Playwright
 * MCP server is not configured" — a commented-out config reported as a missing
 * one (#2252).
 *
 * Deliberately not a full JSON5 implementation: only the two JSONC extensions
 * above are handled, and the result still goes through `JSON.parse`, so an
 * actually-malformed file still throws exactly as before.
 */

/**
 * Remove JSONC comments and trailing commas from a source string.
 *
 * The scan is string-aware, which is the whole difficulty: `//` inside a JSON
 * string is content, not a comment — `"url": "https://example.com"` and
 * `"path": "C:\\a\\b"` must survive, escaped quotes included. Same for a comma
 * inside a string value ("a, }"), which a naive regex would eat.
 *
 * @param {string} source
 * @returns {string} the same document as plain JSON
 */
export function stripJsoncSyntax(source) {
  let out = '';
  let inString = false;
  let escaped = false;
  /** @type {'line' | 'block' | null} */
  let comment = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (comment === 'line') {
      // Keep the newline: it terminates the comment and preserves line numbers
      // in whatever error JSON.parse throws afterwards.
      if (char === '\n') {
        comment = null;
        out += char;
      }
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = null;
        index++;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      comment = 'line';
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      comment = 'block';
      index++;
      continue;
    }

    // A closing brace/bracket outside a string: drop the comma that precedes
    // it, if any. Walking back over the ALREADY-EMITTED output is what makes
    // this safe — a comma inside a string was emitted as string content and is
    // never the character found here, and nesting needs no extra state.
    if (char === '}' || char === ']') {
      let back = out.length - 1;
      while (back >= 0 && /\s/.test(out[back])) back--;
      if (back >= 0 && out[back] === ',') out = out.slice(0, back) + out.slice(back + 1);
    }

    out += char;
  }

  return out;
}

/**
 * Parse a JSONC document. Throws the same way `JSON.parse` does when the
 * document is malformed beyond the two tolerated extensions.
 *
 * @param {string} source
 * @returns {any}
 */
export function parseJsonc(source) {
  return JSON.parse(stripJsoncSyntax(source));
}

/**
 * Parse a config file by extension: `.jsonc` tolerates comments and trailing
 * commas, everything else stays strict JSON so existing `.json` behaviour is
 * untouched.
 *
 * @param {string} filePath
 * @param {string} source
 * @returns {any}
 */
export function parseConfigByExtension(filePath, source) {
  return filePath.toLowerCase().endsWith('.jsonc') ? parseJsonc(source) : JSON.parse(source);
}
