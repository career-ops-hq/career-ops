// The decisions /api/status makes around its set-status.mjs child, kept here so
// they are testable without spawning anything.

// What the caller is told when the CLI supplied no usable message of its own.
const GENERIC_FAILURE = "status update failed";

/**
 * The CLI's JSON document, or null when stdout carries none.
 *
 * `--json` prints one JSON object, but diagnostics can precede it — a ledger
 * append warning, say. Scanning forward to the first `{` finds a brace inside
 * that diagnostic just as readily as the document, and the resulting slice does
 * not parse. The route then reports 500 for a write the CLI already committed,
 * losing `changed` and `statusLogged` with it.
 *
 * So the document is read from the end: the last line that parses as a plain
 * object is the result. A diagnostic that happens to be valid JSON cannot shadow
 * it, because the result is printed last.
 *
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function parseCliJson(stdout) {
  const lines = String(stdout ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      // Not the document line. Keep scanning earlier lines.
    }
  }
  return null;
}

/**
 * The message that goes in the response body for a failed run.
 *
 * Only the CLI's own `error` string is passed through. Child stderr never is:
 * on the exit-1 crash path it is a Node stack trace carrying absolute server
 * paths, which is exactly the content the spawn-failure path already refuses to
 * echo. Guarding one of the two and not the other left the disclosure open on
 * the path most likely to produce a stack trace in the first place.
 *
 * stderr still belongs in the server log — the caller just never sees it, which
 * is why this takes it and ignores it rather than letting a caller forget it
 * exists.
 *
 * @param {Record<string, unknown> | null} parsed
 * @param {string} [_stderr] Deliberately unused; log it at the call site.
 * @returns {string}
 */
export function clientErrorMessage(parsed, _stderr) {
  return typeof parsed?.error === "string" ? parsed.error : GENERIC_FAILURE;
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
