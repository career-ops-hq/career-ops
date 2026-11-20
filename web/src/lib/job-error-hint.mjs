// Classifies WHY a worker job ended in error and picks the matching hint.
// Reads ONLY the job's terminal step label — the exact, structured message
// job-store.tsx (client) or /api/run (server) set when the run ended — never
// the free-form assistant output. Scanning accumulated assistant text used to
// false-positive: career-ops evaluates AI/tech job postings, so the output
// routinely contains words like "credential", "sign-in", "authenticate" as
// ordinary JD/CV prose, unrelated to whether the CLI itself is signed in.
//
// Terminal labels this classifies against (see job-store.tsx / api/run/route.ts):
//   Real not-configured / auth failure -> "auth":
//     "No CLI configured — open Config"                                   (job-store.tsx, no cliId)
//     raw CLI stderr matched for auth keywords                            (api/run/route.ts stderr handler)
//     "The CLI exited with an error — is it installed and authenticated?"
//     "The CLI produced no output — is it installed and authenticated? (...)"
//   Connection dropped mid-stream, CLI never got a chance to fail -> "connection":
//     "Connection error"                                                  (job-store.tsx)
//   Page reload orphaned a running job -> "interrupted":
//     "Interrupted (page reloaded)"                                       (job-store.tsx restore effect)
//   Rate limit. Any label that is a rate limit stays null. A Grok error event
//   can be the 429 line itself, with no "Rate limit." prefix, and that line
//   can still say "login" or "API key".
//   "The CLI returned nothing." and "The CLI exited with an error." quote a
//   stderr line. The quote asks for sign-in only when that line is a sign-in
//   failure. "API key loaded successfully" and "API key configured" are not.
//   Everything else (bad input, missing CV, no report written, etc.) -> null;
//   the error text itself is the explanation.

// "auth" as a bare substring matched inside unrelated words like "author" —
// career-ops evaluates AI/tech job postings, so a terminal label can
// legitimately read something like "Failed to parse author metadata".
// authenticat\w* matches authenticate/authenticated/authentication (the
// actual terminal-label forms listed above) without matching author/authority.
const AUTH_PATTERN =
  /authenticat\w*|login|sign[ -]?in|credential|api[ -]?key|unauthorized|no cli configured/i;

// Same rate-limit words noOutputError uses. Structured error events skip that
// helper and arrive as the raw CLI line, so the hint has to recognize them too.
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|too many requests/i;

// A status line can name a key without asking anyone to sign in.
// "please login" is still a request when the same line says the key is configured.
const SIGN_IN_SUCCESS_RE = /\b(?:succeed(?:ed)?|success(?:ful(?:ly)?)?|loaded|configured)\b/i;
const SIGN_IN_FAILURE_RE = /\b(?:invalid|missing|expired|rejected|fail(?:ed|ure)?|unauthorized|revoked|denied|not)\b/i;
const SIGN_IN_REQUEST_RE = /please (?:log ?in|sign[ -]?in)/i;

/** The stderr quote on a canned message that did not already say to sign in. */
function nonAuthQuote(label) {
  const match = label.match(/^(The CLI returned nothing\.|The CLI exited with an error\.) \((.*)\)$/);
  return match ? match[2] : null;
}

/** A quoted line asks for sign-in only when it is a sign-in failure. */
function quoteIsSignIn(detail) {
  if (!detail || RATE_LIMIT_PATTERN.test(detail)) return false;
  if (SIGN_IN_REQUEST_RE.test(detail)) return true;
  if (!AUTH_PATTERN.test(detail)) return false;
  if (SIGN_IN_SUCCESS_RE.test(detail) && !SIGN_IN_FAILURE_RE.test(detail)) return false;
  return true;
}

const HINTS = {
  auth: { kind: "auth", text: "Sign your CLI in from Config, then re-run." },
  connection: { kind: "connection", text: "Lost connection to the local server — re-run." },
  interrupted: { kind: "interrupted", text: "The run was interrupted — re-run it." },
};

/** The message set on the job's last step — the authoritative terminal cause. */
function lastStepLabel(job) {
  if (!job || job.status !== "error") return "";
  const steps = job.steps || [];
  return steps[steps.length - 1]?.label ?? "";
}

/** Pick the hint (or null) for an errored job, based on its terminal label only. */
export function jobErrorHint(job) {
  const label = lastStepLabel(job);
  if (!label) return null;
  if (label === "Connection error") return HINTS.connection;
  if (label === "Interrupted (page reloaded)") return HINTS.interrupted;
  // "API key" or "login" inside a 429 line is why the limit fired.
  if (RATE_LIMIT_PATTERN.test(label)) return null;
  const quoted = nonAuthQuote(label);
  if (quoted !== null) return quoteIsSignIn(quoted) ? HINTS.auth : null;
  if (AUTH_PATTERN.test(label)) return HINTS.auth;
  return null;
}
