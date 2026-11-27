// The web's "Add to pipeline" for a pasted URL: what the request may carry into
// the core's captureJd() (capture-jd.mjs, #7272), and how the short-lived child
// that runs it answers. Kept as plain .mjs so a `node --test` can load it
// without the `@/` alias capture.ts uses.
//
// The web only writes files here. captureJd() also accepts `commit`, `push`
// and `dataRoot`; none of them is forwarded, so a request cannot make the web
// commit, push the inbox to a remote, or write outside the resolved data root.
// No evaluation is started either: that stays the separate Evaluate action.

/** Same ceiling capture-server.mjs puts on a request body. */
export const MAX_CAPTURE_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_LABEL_CHARS = 200;

/**
 * @param {unknown} body
 * @returns {{ input: { url: string, text?: string, company?: string, role?: string } } | { error: string }}
 */
export function parseCaptureRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "bad request" };
  const { url, text, company, role } = /** @type {Record<string, unknown>} */ (body);
  if (typeof url !== "string" || !url.trim()) return { error: "Paste a full job-posting URL (https://…)." };

  /** @type {{ url: string, text?: string, company?: string, role?: string }} */
  const input = { url: url.trim() };
  if (text !== undefined && text !== null) {
    if (typeof text !== "string") return { error: "bad request" };
    if (Buffer.byteLength(text, "utf8") > MAX_CAPTURE_TEXT_BYTES) return { error: "The job description is too long (2 MiB max)." };
    if (text.trim()) input.text = text;
  }
  for (const [key, value] of /** @type {const} */ ([["company", company], ["role", role]])) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return { error: "bad request" };
    const label = value.trim().slice(0, MAX_LABEL_CHARS);
    if (label) input[key] = label;
  }
  return { input };
}

/**
 * Reads the one JSON line the capture child prints. A child that dies before
 * answering prints nothing, and that must read as a failure, never as success.
 *
 * @param {string} stdout
 * @param {string} stderr
 * @param {{ code: number | null, signal: string | null }} exit
 * @returns {{ ok: true, appended: boolean, duplicate: boolean, hasText: boolean, company?: string, role?: string } | { ok: false, error: string, invalid?: boolean }}
 */
export function captureWriterResult(stdout, stderr, exit) {
  const last = String(stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
  if (last) {
    try {
      const parsed = JSON.parse(last);
      if (parsed && typeof parsed === "object" && parsed.ok === true) {
        return {
          ok: true,
          appended: parsed.appended === true,
          duplicate: parsed.duplicate === true,
          hasText: parsed.hasText === true,
          ...(typeof parsed.company === "string" ? { company: parsed.company } : {}),
          ...(typeof parsed.role === "string" ? { role: parsed.role } : {}),
        };
      }
      if (parsed && typeof parsed === "object" && parsed.ok === false) {
        return { ok: false, error: String(parsed.error || "capture failed"), ...(parsed.invalid ? { invalid: true } : {}) };
      }
    } catch {
      // Not the writer's answer; fall through to the exit status.
    }
  }
  const said = String(stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Node\.js v\d/.test(l));
  const why = said.find((l) => /^\w*Error\b/.test(l)) ?? said.pop();
  const how = exit?.signal ? `killed by ${exit.signal}` : exit?.code ? `exit code ${exit.code}` : "no result";
  return { ok: false, error: `capture writer failed (${how})${why ? `: ${why.slice(0, 200)}` : ""}` };
}
