// One copy of the patterns both the empty-reply message and the worker hint use.
// A hyphen is a word boundary, so a plain 429 match would hit the 429 inside
// a request id such as req-429-abc.
export const RATE_LIMIT_RE = /(?<![\w-])429(?![\w-])|rate limit|too many requests/i;

export const SIGN_IN_REQUEST_RE = /please (?:log ?in|sign[ -]?in)/i;

export const AUTH_FAILURE_RE = /\bauthentication\s+failed\b|\bnot\s+authenticated\b|\bunauthenticated\b|\bunauthorized\b/i;

// A status line can name a key without asking anyone to sign in.
export const KEY_STATUS_RE = /\b(?:succeed(?:ed)?|success(?:ful(?:ly)?)?|loaded|configured)\b/i;

// The key itself failed. "network connection failed" does not count.
// "not configured" is not here. The worker hint adds that on its own.
export const KEY_FAILURE_RE = /(?:invalid|missing|expired|rejected|revoked|denied)\s+(?:\w+\s+){0,3}(?:credentials?|api[ -]?key)|(?:not|no)\s+(?:valid\s+)?(?:credentials?|api[ -]?key)|(?:credentials?|api[ -]?key)\s+(?:(?:is|was|has|have|had)\s+)?(?:invalid|missing|expired|rejected|revoked|denied|not\b)/i;

/** Hint only. A missing CLI or key is a sign-in failure. "proxy not configured" is not. */
export const NOT_CONFIGURED_RE = /\bno\s+(?:cli|api[ -]?key|credentials?)\s+configured\b|\b(?:cli|api[ -]?key|credentials?)\s+not\s+configured\b/i;

export const CLAUDE_CODE_TIP = " (career-ops is best on Claude Code.)";
