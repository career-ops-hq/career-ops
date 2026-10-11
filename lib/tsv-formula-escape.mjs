/**
 * tsv-formula-escape.mjs — reversible spreadsheet-formula escaping for TSV
 * cells career-ops writes and later reads back.
 *
 * A cell starting with `=`, `+`, `-` or `@` runs as a formula when the file is
 * opened in a spreadsheet, so writers prefix such a cell with `'`. To keep the
 * escaping reversible, a cell that already starts with one or more apostrophes
 * followed by one of those characters gets one more `'` too; readers strip
 * exactly one. `unescapeFormulaCell(escapeFormulaCell(x)) === x` for every
 * string, so a value read back compares equal to the value that was written.
 *
 * Every reader of a file written with this escaping must unescape, or it sees
 * the stored form. Dependency-free, so any script can import it.
 */

/**
 * @param {unknown} value
 * @returns {string} The cell as it is stored.
 */
export function escapeFormulaCell(value) {
  const cell = String(value ?? '');
  return /^'*[=+\-@]/.test(cell) ? `'${cell}` : cell;
}

/**
 * @param {unknown} value - A stored cell.
 * @returns {string} The value that was written.
 */
export function unescapeFormulaCell(value) {
  const cell = String(value ?? '');
  return cell.replace(/^'(?='*[=+\-@])/, '');
}
