export const CV_CONFLICT_ERROR = "cv.md changed somewhere else. Your text is still in this tab.";

const MAX_CV_BYTES = 200_000;

/**
 * The file on disk is the text this editor last saw. A missing file matches
 * only an editor that also saw no file.
 *
 * @param {{ exists: boolean, content: string }} disk
 * @param {{ exists: boolean, content: string }} expected
 */
export function cvBaseMatches(disk, expected) {
  if (expected.exists !== disk.exists) return false;
  if (!disk.exists) return true;
  return disk.content === expected.content;
}

/**
 * Whether a CV save may replace the file. A save that does not name the text
 * it started from is refused, so a later autosave cannot overwrite a change
 * it never read.
 *
 * @param {{ exists: boolean, content: string }} disk
 * @param {{ content?: unknown, backup?: unknown, expected?: { content?: unknown, exists?: unknown } } | null} body
 * @returns {{ ok: true, backup: boolean } | { ok: false, status: number, error: string }}
 */
export function decideCvWrite(disk, body) {
  if (!body || typeof body.content !== "string") return { ok: false, status: 400, error: "content required" };
  if (Buffer.byteLength(body.content, "utf8") > MAX_CV_BYTES) {
    return { ok: false, status: 413, error: "CV is too large (over 200KB)" };
  }
  const expected = body.expected;
  if (!expected || typeof expected.content !== "string" || typeof expected.exists !== "boolean" || !cvBaseMatches(disk, { exists: expected.exists, content: expected.content })) {
    return { ok: false, status: 409, error: CV_CONFLICT_ERROR };
  }
  return { ok: true, backup: body.backup !== false };
}
