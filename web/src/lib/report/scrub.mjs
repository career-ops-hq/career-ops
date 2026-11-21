// PII / secret scrubber for the in-app bug reporter (report.ts).
//
// Runs on the route, logs, user agent and description BEFORE they go into a
// public GitHub issue. Defence in depth: the user also reviews the full payload
// (preview-then-confirm) before the issue opens, but this is the only automated
// guard. Plain .mjs so it can be tested without a build (report.ts imports
// ./logbuf with no extension, which Node cannot resolve).

// One word of a Windows account name. An apostrophe followed by a name
// character stays in the word (O'Brien); one before a separator, a space or the
// end is a closing quote. `:` cannot appear in a Windows account name, which
// keeps a URL scheme ("https:") out of the match.
const WIN_WORD = String.raw`(?:[^\\/\s"':]|'(?=[^\\/\s"':]))+`;

// Windows home directory, either slash style, any number of slashes (a path
// inside a JSON-encoded error message has its backslashes doubled). A name of
// up to three space-separated words ("Jane Doe") is taken whole only when a
// separator of either style or a closing quote follows it; otherwise just the
// first word, so the rest of a sentence after a bare home directory survives.
const WINDOWS_HOME = new RegExp(
  String.raw`\b[A-Za-z]:(?:\\+|\/+)Users(?:\\+|\/+)(?:${WIN_WORD}(?: ${WIN_WORD}){1,2}(?=[\\/"'])|${WIN_WORD})`,
  "gi",
);
// POSIX account names cannot contain spaces, and `\` is an ordinary character,
// except where it starts a JSON escape: in a serialized log line
// ("/home/jdoe\nEACCES") the name ends at the `\n`. A `\uXXXX` escape is a
// character of the name ("/home/\u006aane" is "/home/jane").
const POSIX_HOME = /\/(?:Users|home)\/(?:[^/\s"'\\]|\\u[0-9A-Fa-f]{4}|\\(?![nrtbfu"\\/]))+/g;

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
// matching inside a word ("task-12345678", "monkey: …"), while still allowing a
// `_` before it so `GITHUB_TOKEN=` and `secret_key=` are caught. Compound names
// written in camelCase (`accessToken`, `clientSecret`) are listed explicitly,
// because the lookbehind would otherwise reject them.
const KEYWORD = "(?:(?:access|refresh|auth|client|id|session|private|app|api)[-_]?)?(?:token|secret|key)|sk|bearer";
const KEYED_SECRET = new RegExp(String.raw`(?<![A-Za-z0-9])(${KEYWORD})([-_=:\s"']+)[A-Za-z0-9._-]{8,}`, "gi");

/** @param {string} s */
export function scrub(s) {
  return (s || "")
    .replace(WINDOWS_HOME, "~")
    .replace(POSIX_HOME, "~")
    .replace(PREFIXED_TOKEN, "[redacted]")
    .replace(KEYED_SECRET, "$1$2[redacted]");
}
