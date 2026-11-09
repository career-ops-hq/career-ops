// The assistant's confirm-gated profile and scan-target writes (/api/profile,
// /api/portals). Both routes answer `{ ok: true }` once the file is written and
// a 4xx/5xx with `{ error }` when it is not, so a request that merely completed
// is not a save. Resolves to null when the route confirmed the write, and to
// the reason otherwise, for the console to show instead of a silent success.

/**
 * @param {string} url
 * @param {unknown} body
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string | null>}
 */
export async function postAssistantWrite(url, body, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return "the request failed";
  }
  const data = await response.json().catch(() => null);
  if (response.ok && data?.ok === true) return null;
  return typeof data?.error === "string" && data.error.trim() ? data.error : `HTTP ${response.status}`;
}
