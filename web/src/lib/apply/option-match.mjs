/**
 * Which option of an open combobox menu the fill step may click for an answer.
 *
 * An exact label (trimmed, case-insensitive) wins. Otherwise only a whole-word
 * match is accepted, and only when exactly one option has it: a substring
 * match let "US" click "Australia" and "Male" click "Female". -1 means leave
 * the field for the person.
 */

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * @param {string[]} optionTexts
 * @param {string} value
 * @returns {number}
 */
export function pickComboboxOption(optionTexts, value) {
  const want = norm(value);
  if (!want) return -1;
  const texts = optionTexts.map(norm);
  const exact = texts.indexOf(want);
  if (exact >= 0) return exact;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u");
  const hits = texts.flatMap((t, i) => (word.test(t) ? [i] : []));
  return hits.length === 1 ? hits[0] : -1;
}
