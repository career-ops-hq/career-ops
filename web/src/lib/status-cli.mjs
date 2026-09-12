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
 * One line is not the only shape the document takes, though, and assuming it was
 * made this parser blind on the path that matters most. set-status.mjs prints
 * its FAILURE object compactly (`JSON.stringify({error, code})`) but its SUCCESS
 * object pretty, `JSON.stringify(result, null, 2)` — so a run that actually
 * wrote the tracker produced a multi-line document, no single line parsed, and
 * the route answered 500 "status update returned no result" for a change already
 * committed to data/applications.md and already appended to data/status-log.tsv.
 * Every successful write through /api/status looked like a server error to its
 * caller — worse than the bug this function was written to fix, because the UI
 * then reverts a control over a write that stood.
 *
 * So each candidate is tried twice: as a single line first, then as the head of
 * a multi-line document running to the end of stdout. Only a TOP-LEVEL opening
 * brace is unindented, so the multi-line attempt starts where the document
 * starts; a nested `{` is indented and its slice does not parse.
 *
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function parseCliJson(stdout) {
  const lines = String(stdout ?? "").split("\n");
  /** @param {string} candidate */
  const asObject = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      /* not the document */
    }
    return null;
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    // Column zero, not "starts with a brace once trimmed": the CLI prints its
    // document unindented, so an indented brace belongs to something INSIDE a
    // document — and `"    {}"` from an empty object in an array is a valid
    // single-line candidate that would be returned in place of the result.
    if (!lines[i].startsWith("{")) continue;
    const single = asObject(lines[i].trim());
    if (single) return single;
    const multi = asObject(lines.slice(i).join("\n"));
    if (multi) return multi;
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
