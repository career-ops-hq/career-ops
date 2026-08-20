// The two decisions /api/status makes around its set-status.mjs child, kept
// here so they are testable without spawning anything.

/**
 * The CLI's JSON document, or null when stdout carries none.
 *
 * `--json` prints one JSON object, but diagnostics can precede it — a ledger
 * append warning, say. Scanning forward to the first `{` finds a brace inside
 * that diagnostic just as readily as the document, and the resulting slice does
 * not parse. The route then reports 500 for a write the CLI already committed,
 * losing `changed` and `statusLogged` with it.
 *
 * So candidate objects are read from the end. This supports both compact JSON
 * and the pretty-printed multi-line JSON emitted by set-status.mjs. A diagnostic
 * object cannot shadow the result because the result is printed last.
 *
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function parseCliJson(stdout) {
  const text = String(stdout ?? "");
  for (let end = text.lastIndexOf("}"); end >= 0; end = text.lastIndexOf("}", end - 1)) {
    for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return /** @type {Record<string, unknown>} */ (parsed);
        }
      } catch {
        // This brace pair was diagnostic text or a nested fragment.
      }
    }
  }
  return null;
}

/**
 * The `--row` argument for a request's row selector, or null when it names none.
 *
 * `n` arrives from untrusted JSON and is only typed as a string, so it can be an
 * array, an object, or a non-numeric string. `String(n)` turns those into
 * `"[object Object]"` and similar, which costs a process spawn and a tracker
 * lock acquisition to learn what a check here answers for free — and returns the
 * CLI's usage text rather than a message about the field.
 *
 * Not an injection concern: execFile takes an argv array and `--row` consumes
 * the next token as its value, so a flag-shaped value cannot introduce an
 * option. This is about cost and about answering the caller specifically.
 *
 * @param {unknown} n
 * @returns {string | null}
 */
export function trackerRowArg(n) {
  if (typeof n !== "string" && typeof n !== "number") return null;
  const row = String(n).trim();
  return /^\d+$/.test(row) ? row : null;
}
