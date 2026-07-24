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
//   Everything else (bad input, missing CV, no report written, etc.) -> null;
//   the error text itself is the explanation.

const AUTH_PATTERN =
  /auth|login|sign[ -]?in|credential|api[ -]?key|unauthorized|not authenticated|installed and authenticated|no cli configured/i;

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
  if (AUTH_PATTERN.test(label)) return HINTS.auth;
  return null;
}
