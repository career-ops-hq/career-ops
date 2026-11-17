/**
 * Which boxes a checkbox-group answer is asking for.
 *
 * An answer that equals one option stays one option, even when that label
 * contains a comma. Several options are read from the front of the answer,
 * longest option first, so "Sales, Marketing, Engineering" can mean the
 * option "Sales, Marketing" plus "Engineering". A piece that matches nothing
 * is kept, and the fill reports that the group was not completed.
 *
 * @param {string} value
 * @param {string[]} options
 * @returns {string[]}
 */
export function checkboxSelections(value, options) {
  const tidy = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const key = (text) => tidy(text).toLowerCase();
  const known = (Array.isArray(options) ? options : []).map(tidy).filter(Boolean);
  const trimmed = tidy(value);
  if (!trimmed) return [];
  const exact = known.find((option) => key(option) === key(trimmed));
  if (exact) return [exact];

  const sorted = [...known].sort((a, b) => b.length - a.length);
  const wanted = [];
  let rest = trimmed;
  while (rest) {
    const hit = sorted.find((option) => {
      const remaining = key(rest);
      const optionKey = key(option);
      return remaining === optionKey || remaining.startsWith(`${optionKey},`);
    });
    if (!hit) {
      const comma = rest.indexOf(",");
      if (comma === -1) {
        wanted.push(rest);
        break;
      }
      const piece = rest.slice(0, comma).trim();
      if (piece) wanted.push(piece);
      rest = rest.slice(comma + 1).trim();
      continue;
    }
    wanted.push(hit);
    if (key(rest) === key(hit)) break;
    const escaped = hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = rest.replace(new RegExp(`^\\s*${escaped}\\s*,\\s*`, "i"), "");
    if (next === rest) {
      wanted.push(rest);
      break;
    }
    rest = tidy(next);
  }
  return wanted;
}

/**
 * Whether this box is one of the requested options.
 * A 160-character cut can leave a trailing space on the live option.
 * The selections are already tidied.
 *
 * @param {string[]} wanted
 * @param {string} option
 * @returns {boolean}
 */
export function checkboxOptionWanted(wanted, option) {
  const shown = String(option ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return (Array.isArray(wanted) ? wanted : []).some((part) => String(part).toLowerCase() === shown);
}

/**
 * Whether the checkbox ended in the requested state.
 *
 * The first setChecked attempt resolves only when Playwright saw that state.
 * After it throws, a second attempt is forced and the box is read. A failed
 * read is null. null is not an unchecked box, so a deselection whose state
 * cannot be read does not count as done.
 *
 * @param {(want: boolean, options: {timeout?: number, force?: boolean}) => Promise<void>} setChecked
 * @param {(options: {timeout?: number}) => Promise<boolean>} isChecked
 * @param {boolean} want
 * @returns {Promise<boolean>}
 */
export async function confirmCheckbox(setChecked, isChecked, want) {
  try {
    await setChecked(want, { timeout: 3000 });
    return true;
  } catch {
    try {
      await setChecked(want, { force: true, timeout: 1000 });
    } catch {
      // The forced attempt failed too. The read below decides the result.
    }
    let seen = null;
    try {
      seen = await isChecked({ timeout: 1000 });
    } catch {
      seen = null;
    }
    return seen === want;
  }
}
