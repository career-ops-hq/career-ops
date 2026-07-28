import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { canonicalizeStatus } from "@/lib/core/states";
import { atomicWrite } from "@/lib/core/safe-write";

// Writeback: UPDATE the status cell of an EXISTING tracker row only. Never adds
// rows — per the core data contract, new rows go through the TSV + merge flow.
// HARDENED: validate against the 8 canonical states (states.yml SSOT); reject any
// value with table-breaking chars (| \r \n **) that would scramble the row; detect
// the Status column from the header (8- and 9-col layouts); atomic write.
export async function POST(req: Request) {
  let body: { n?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { n, status } = body;
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

  const file = path.join(careerOpsRoot(), "data", "applications.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  }

  const lines = md.split("\n");
  // Find the Status column index from the header row (robust to 8- vs 9-col).
  let statusIdx = 6;
  for (const l of lines) {
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|").map((c) => c.trim().toLowerCase());
    const idx = cells.findIndex((c) => c === "status");
    if (idx > 0) {
      statusIdx = idx;
      break;
    }
    if (/^:?-{2,}:?$/.test(cells[1] ?? "")) break; // hit the separator → no header match, keep default
  }

  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const parts = lines[i].split("|");
    if (parts.length < 8) continue;
    if (parts[1].trim() !== String(n)) continue;
    if (statusIdx >= parts.length - 1) continue; // guard malformed row
    parts[statusIdx] = ` ${canon} `;
    lines[i] = parts.join("|");
    changed = true;
    break;
  }
  if (!changed) return NextResponse.json({ error: "row not found" }, { status: 404 });

  try {
    atomicWrite(file, lines.join("\n"));
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: canon });
}
