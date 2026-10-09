/**
 * _ids.mjs — one coercion for every ATS-native identifier a provider captures.
 *
 * Each board hands its id back in a different JS type: Greenhouse `id` is a
 * number, Ashby and Lever posting ids are uuid strings, Eightfold varies by
 * tenant and has been observed returning an object. The guard is the same
 * everywhere — accept a string or a number, trim it, treat empty as absent —
 * and it was being hand-rolled once per provider, which is how they drifted:
 * greenhouse coerced with a bare String() and would have written the literal
 * "[object Object]" into an id field for a tenant that returned an object,
 * the exact failure eightfold had already been hardened against.
 *
 * ABSENT BEATS WRONG. An id that cannot be coerced returns undefined rather
 * than a placeholder: a missing key makes a consumer fall back to its other
 * signals, while a wrong key makes it confidently match the wrong posting.
 *
 * @param {unknown} raw - The id as the board returned it.
 * @returns {string|undefined} The trimmed id, or undefined when there is none.
 */
export function coerceId(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const s = String(raw).trim();
  return s === '' ? undefined : s;
}

export default coerceId;
