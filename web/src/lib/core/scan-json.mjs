/**
 * Parse scan-ats-full --json stdout. Progress lives on stderr, but Node
 * warnings or a banner can still prefix the object, and a SIGTERM can
 * truncate it. JSON.parse of the whole buffer used to fail and Discover
 * reported 0 offers after the live counter had already shown matches.
 *
 * Plain .mjs so tests/lib/scan-json.test.mjs can import it without a TS runner.
 */
import { extractJsonObject } from "../extract-json-object.mjs";

/**
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseScanJsonStdout(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* prefixed or truncated — salvage below */
  }
  return extractJsonObject(text).obj;
}
