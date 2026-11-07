/*
 * Pick the line that explains a failed scheduled scan.
 *
 * The scanners write progress to stderr before they fail (scan-ats-full.mjs
 * sends every human line there in --json mode, starting with its run header),
 * so the first stderr line is almost never the cause. The cause is the last
 * `Error:` / `Fatal:` / `SomethingError:` line, with or without the bracketed
 * code Node puts in its own errors (`Error [ERR_MODULE_NOT_FOUND]: ...`);
 * failing that, the last line that is not a stack frame or Node's trailing
 * version banner.
 */

const MAX_LENGTH = 300;
const CAUSE_LINE = /^(?:Fatal|[A-Za-z]*Error)\b(?:\s*\[[A-Z][A-Z0-9_]*\])?\s*:/;
const NOISE_LINE = /^\s+at\s|^Node\.js v\d/;

export function stderrCause(stderr) {
  const lines = String(stderr || "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const cause = lines.findLast((line) => CAUSE_LINE.test(line))
    || lines.findLast((line) => !NOISE_LINE.test(line));
  return cause ? cause.trim().slice(0, MAX_LENGTH) : "";
}

/*
 * `result` is a spawnSync result, or `{ error }` for a thrown setup failure.
 * A spawn-level error (timeout, output overflow, missing binary) wins over
 * stderr: when spawnSync kills a scanner at its timeout, stderr still holds
 * the progress it had printed, which says nothing about why it stopped.
 */
export function scanFailureMessage(result, { timeoutMs } = {}) {
  const error = result?.error;
  if (error?.code === "ETIMEDOUT") {
    const minutes = timeoutMs ? Math.round(timeoutMs / 60_000) : null;
    return minutes ? `Scanner timed out after ${minutes} minutes.` : "Scanner timed out.";
  }
  if (error) return String(error.message || error).split(/\r?\n/)[0].slice(0, MAX_LENGTH) || "Scan failed";
  const cause = stderrCause(result?.stderr);
  if (cause) return cause;
  if (result?.signal) return `Scanner stopped by ${result.signal}.`;
  return `scanner exit ${result?.status ?? "unknown"}`;
}
