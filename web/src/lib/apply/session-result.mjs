// Client-safe. The apply page uses this to stop before drive and prefill.
// It does not import the engine, Node, or Playwright.

/**
 * @param {unknown} body
 * @returns {{ kind: "continue" } | { kind: "unsupported", message: string, postingUrl: string, checklistHref: string }}
 */
export function sessionFollowUp(body) {
  if (!body || typeof body !== "object" || body.unsupported !== true) return { kind: "continue" };
  const record = /** @type {Record<string, unknown>} */ (body);
  return {
    kind: "unsupported",
    message: typeof record.message === "string" ? record.message : "",
    postingUrl: typeof record.postingUrl === "string" ? record.postingUrl : "",
    checklistHref: typeof record.checklistHref === "string" ? record.checklistHref : "",
  };
}
