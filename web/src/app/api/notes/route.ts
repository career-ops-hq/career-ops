import { findApplication } from "@/lib/career-ops";
import { runSetStatus, type CliResult } from "@/lib/core-cli";
import { canonicalizeStatus } from "@/lib/core/states";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";

type NotesRequest = { n?: unknown; status?: unknown; note?: unknown; replaceNote?: unknown; removeNote?: unknown; expectedNotes?: unknown; noteIndex?: unknown };
const validNote = (value: unknown): value is string => typeof value === "string" && value.length <= 4000 && !value.includes("\0") && !!value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim();

// Note-only edits delegate to the existing locked writer. Status and deletion
// snapshot guards prevent a stale dialog from overwriting another change.
export async function POST(req: Request) {
  const body = await readJsonObject<NotesRequest>(req);
  const n = trackerRowArg(body?.n);
  const status = typeof body?.status === "string" ? canonicalizeStatus(body.status) : null;
  const removing = body?.removeNote !== undefined;
  const validSnapshot = typeof body?.expectedNotes === "string" && body.expectedNotes.length <= 64000 && !body.expectedNotes.includes("\0");
  const editing = body?.replaceNote !== undefined;
  const validAction = body && (removing
    ? validNote(body.removeNote) && body.note === undefined && body.replaceNote === undefined && validSnapshot && body.noteIndex === undefined
    : validNote(body.note) && (editing ? validNote(body.replaceNote) && typeof body.noteIndex === "number" && Number.isSafeInteger(body.noteIndex) && body.noteIndex >= 0 && validSnapshot : body.noteIndex === undefined && body.expectedNotes === undefined));
  if (!body || !n || !status || !validAction) {
    return Response.json({ error: "Choose a note of up to 4,000 characters for this job." }, { status: 400 });
  }
  const args = ["--row", n, status, "--expect-status", status, "--source", "web", "--json"];
  if (removing) args.push(`--remove-note=${body.removeNote}`, `--expect-notes=${body.expectedNotes}`);
  else {
    args.push(`--note=${body.note}`);
    if (typeof body.replaceNote === "string") args.push(`--replace-note=${body.replaceNote}`, `--note-index=${body.noteIndex}`, `--expect-notes=${body.expectedNotes}`);
  }
  let result: CliResult;
  try {
    result = await runSetStatus(args);
  } catch (error) {
    console.error("[career-ops] Could not update job notes:", error);
    return Response.json({ error: "Could not update the note. Please try again." }, { status: 500 });
  }
  const parsed = parseCliJson(result.stdout);
  if (result.code !== 0 || typeof parsed?.[removing ? "removedNote" : "note"] !== "string") {
    const code = parsed?.code;
    const missingNote = ["replace-note-not-found", "remove-note-not-found"].includes(String(code));
    const clientError = ["usage", "invalid-state", "no-notes-column"].includes(String(code)) || missingNote;
    const status = result.code === 2 ? 404 : result.code === 3 || missingNote ? 409 : result.code === 4 ? 503 : clientError ? 400 : 500;
    return Response.json({ error: typeof parsed?.error === "string" && (clientError || [2, 3, 4].includes(result.code)) ? parsed.error : "Could not update the note. Please try again." }, { status });
  }
  try {
    const current = findApplication(n);
    if (!current) return Response.json({ error: "The job is no longer available. Refresh Pipeline." }, { status: 409 });
    return Response.json({ ok: true, notes: current.notes });
  } catch (error) {
    console.error("[career-ops] Could not reload job notes after saving:", error);
    return Response.json({ error: "The note was saved, but could not be reloaded. Refresh Pipeline." }, { status: 500 });
  }
}
