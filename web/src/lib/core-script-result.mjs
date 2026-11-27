/**
 * HTTP mapping for a career-ops CLI invoked with --json.
 * Exit 1 covers both caller mistakes and server faults (a failed tracker
 * write, an fs error), so only the codes listed here map to 400; any other
 * exit-1 code is a 500. Exit 2/3/4 match set-status.mjs: not found,
 * ambiguous, lock timeout.
 */

// Exit-1 codes that are the caller's fault: usage and no-pdf-column from
// mark-pdf-ready.mjs; USAGE, INVALID_DATE and NOT_APPLIED from followup-seed.mjs.
const CLIENT_ERROR_CODES = new Set(["usage", "no-pdf-column", "USAGE", "INVALID_DATE", "NOT_APPLIED"]);

const EXIT_TO_HTTP = { 2: 404, 3: 409, 4: 503 };

/**
 * @param {{ code: number, parsed: Record<string, unknown> | null, fallback: string }} input
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function coreScriptHttp({ code, parsed, fallback }) {
  if (code === 0) return { status: 200, body: parsed ?? { ok: true } };
  const error = typeof parsed?.error === "string" ? parsed.error : fallback;
  const cliCode = typeof parsed?.code === "string" ? parsed.code : null;
  if (code === 1 && typeof parsed?.error === "string" && cliCode && CLIENT_ERROR_CODES.has(cliCode)) {
    return { status: 400, body: { error, code: cliCode } };
  }
  return { status: EXIT_TO_HTTP[code] ?? 500, body: { error, code: cliCode } };
}
