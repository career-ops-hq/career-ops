/**
 * HTTP mapping for a career-ops CLI invoked with --json.
 * Exit 1 with a parsed error is the caller's fault. Exit 2/3/4 match
 * set-status.mjs: not found, ambiguous, lock timeout.
 */

const EXIT_TO_HTTP = { 2: 404, 3: 409, 4: 503 };

/**
 * @param {{ code: number, parsed: Record<string, unknown> | null, fallback: string }} input
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function coreScriptHttp({ code, parsed, fallback }) {
  if (code === 0) return { status: 200, body: parsed ?? { ok: true } };
  const error = typeof parsed?.error === "string" ? parsed.error : fallback;
  const cliCode = typeof parsed?.code === "string" ? parsed.code : null;
  if (code === 1 && typeof parsed?.error === "string") {
    return { status: 400, body: { error, code: cliCode } };
  }
  return { status: EXIT_TO_HTTP[code] ?? 500, body: { error, code: cliCode } };
}
