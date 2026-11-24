// How Explore's filter boxes turn typed or pasted text into entries, and how a
// list of entries is written into one URL parameter and read back (#7424).
//
// A comma ends an entry, so a value that holds one ("Portland, OR") needs a way
// to say so. The rule is the CSV one: an entry that starts with a double quote
// runs to the closing quote, and "" inside it is a literal quote. Text without
// quotes splits exactly as before.
//
// Plain .mjs so the web node:test suite can import it without a TS runner.

/** What ends an entry in a filter box. Spaces never do ("New York", #1147). */
const TYPED_SEPARATORS = ",;\n\r\t";

/** What ends an entry in a URL parameter. Only the comma, as before. */
const PARAM_SEPARATOR = ",";

/**
 * @param {string} text
 * @param {string} separators
 * @returns {{ parts: string[], open: boolean, split: boolean }}
 *   parts: the entries, untrimmed (cleanChips trims and drops empties);
 *   open: the text ends inside a quote that was never closed;
 *   split: a separator outside quotes was seen.
 */
function scan(text, separators) {
  const parts = [];
  let field = "";
  let open = false;
  let atStart = true; // only spaces read in this entry so far
  let split = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (open) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else open = false;
      continue;
    }
    if (separators.includes(ch)) {
      parts.push(field);
      field = "";
      atStart = true;
      split = true;
      continue;
    }
    if (atStart && ch === '"') {
      open = true;
      field = "";
      atStart = false;
      continue;
    }
    if (!/\s/.test(ch)) atStart = false;
    field += ch;
  }
  parts.push(field);
  return { parts, open, split };
}

/**
 * Typed or pasted box text → entries. An unclosed quote runs to the end.
 * @param {string} text
 * @returns {string[]}
 */
export function splitChipText(text) {
  return scan(text, TYPED_SEPARATORS).parts;
}

/**
 * The box value just ended in a separator that is not inside a quote.
 * @param {string} value
 * @returns {boolean}
 */
export function commitsOnType(value) {
  return value.length > 0 && TYPED_SEPARATORS.includes(value[value.length - 1]) && !scan(value, TYPED_SEPARATORS).open;
}

/**
 * Pasted text (with the draft before it) holds a separator outside quotes.
 * @param {string} text
 * @returns {boolean}
 */
export function commitsOnPaste(text) {
  return scan(text, TYPED_SEPARATORS).split;
}

/**
 * An entry that holds a comma, or starts with a quote, is written quoted.
 * @param {string} entry
 * @returns {string}
 */
function quoteForParam(entry) {
  return entry.includes(PARAM_SEPARATOR) || entry.trimStart().startsWith('"')
    ? `"${entry.replaceAll('"', '""')}"`
    : entry;
}

/**
 * Entries → one URL parameter value. Entries without a comma or a leading
 * quote are written exactly as before, so existing links do not change.
 * @param {string[]} entries
 * @returns {string}
 */
export function joinChipParam(entries) {
  return entries.map(quoteForParam).join(PARAM_SEPARATOR);
}

/**
 * One URL parameter value → entries; the inverse of joinChipParam. A link
 * written before quoting existed reads as it always did.
 * @param {string} value
 * @returns {string[]}
 */
export function splitChipParam(value) {
  return scan(value, PARAM_SEPARATOR).parts;
}
