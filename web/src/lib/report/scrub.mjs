// PII / secret scrubber for the in-app bug reporter (report.ts).
//
// Runs on the route, logs, user agent and description BEFORE they go into a
// public GitHub issue. Defence in depth: the user also reviews the full payload
// (preview-then-confirm) before the issue opens, but this is the only automated
// guard. Plain .mjs so it can be tested without a build (report.ts imports
// ./logbuf with no extension, which Node cannot resolve).

// Windows home directory, either slash style, any number of slashes (a path
// inside a JSON-encoded error message has its backslashes doubled).
const WINDOWS_HOME = /\b[A-Za-z]:(?:\\+|\/+)Users(?:\\+|\/+)[^\\/\s"']+/gi;
const POSIX_HOME = /\/(?:Users|home)\/[^/\s"']+/g;

// Tokens recognisable by their prefix alone, with no `key=` in front of them.
const PREFIXED_TOKEN = new RegExp(
  "\\b(?:" +
    [
      "gh[pousr]_[A-Za-z0-9]{20,}", // GitHub classic / OAuth / app tokens
      "github_pat_[A-Za-z0-9_]{20,}", // GitHub fine-grained PAT
      "xox[abprs]-[A-Za-z0-9-]{10,}", // Slack
      "AKIA[0-9A-Z]{16}", // AWS access key id
    ].join("|") +
    ")\\b",
  "g",
);

// `key=value` / `token: value` shapes. The lookbehind keeps the keyword from
// matching inside a word ("task-12345678"), while still allowing a `_` before
// it so `GITHUB_TOKEN=` and `secret_key=` are caught.
const KEYED_SECRET = /(?<![A-Za-z0-9])(sk|key|token|secret|bearer|api[-_]?key)([-_=:\s"']+)[A-Za-z0-9._-]{8,}/gi;

/** @param {string} s */
export function scrub(s) {
  return (s || "")
    .replace(WINDOWS_HOME, "~")
    .replace(POSIX_HOME, "~")
    .replace(PREFIXED_TOKEN, "[redacted]")
    .replace(KEYED_SECRET, "$1$2[redacted]");
}
