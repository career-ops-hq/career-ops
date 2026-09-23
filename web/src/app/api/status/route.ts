import { NextResponse } from "next/server";
import { canonicalizeStatus } from "@/lib/core/states";
import { runStatusUpdate } from "@/lib/core/status-update";

// Writeback: UPDATE the status of an EXISTING tracker row via the core scripts —
// set-status.mjs (status-log ledger + tracker lock) or outcome.mjs (archives +
// feedback journal + set-status) for terminal outcomes. Never hand-edits
// applications.md from the web layer.
export async function POST(req: Request) {
  let body: { n?: string; status?: string; feedback?: string; stage?: string; note?: string; on?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { n, status, feedback, stage, note, on } = body;
  if (!n || typeof status !== "string" || !status.trim()) {
    return NextResponse.json({ error: "n and status required" }, { status: 400 });
  }
  if (/[|\r\n*]/.test(status)) {
    return NextResponse.json({ error: "invalid status (table-breaking characters)" }, { status: 400 });
  }
  const canon = canonicalizeStatus(status);
  if (!canon) {
    return NextResponse.json({ error: `not a canonical status: ${status}` }, { status: 400 });
  }
  if (on != null && !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return NextResponse.json({ error: "on must be YYYY-MM-DD" }, { status: 400 });
  }

  const { result, error, status: httpStatus } = runStatusUpdate({
    n: String(n),
    status: canon,
    feedback,
    stage,
    note,
    on,
  });

  if (!result) {
    return NextResponse.json({ error: error || "update failed" }, { status: httpStatus ?? 500 });
  }

  return NextResponse.json(result);
}
