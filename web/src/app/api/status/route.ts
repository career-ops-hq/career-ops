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
  // Find the Status column index from the header row (robust to 8- vs 9-col
  // and an optional Via column that shifts everything right). Also remember
  // the header line's index so the row-scan below can never target it (a
  // request with n: "#" must not match the header's own "#" cell text and
  // corrupt the table's structure). The separator row (e.g. "|---|---|...|")
  // is excluded generically in that scan instead, since it normally follows
  // immediately after the header — this loop breaks at the header before
  // ever reaching it.
  let statusIdx = 6;
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|").map((c) => c.trim().toLowerCase());
    const sIdx = cells.findIndex((c) => c === "status");
    if (sIdx > 0) {
      statusIdx = sIdx;
      headerLineIdx = i;
      break;
    }
    if (/^:?-{2,}:?$/.test(cells[1] ?? "")) {
      // No "Status" column matched, but this is still the separator row —
      // the row immediately above it is the header by markdown-table
      // convention (even if malformed/missing the expected column names).
      // Capture it so the row-scan below still protects it: without this,
      // a malformed header silently loses the n:"#" guard entirely.
      if (headerLineIdx < 0) headerLineIdx = i - 1;
      break; // hit the separator → no header match, keep default
    }
  }

  // Resolve the row by its `#` cell — the tracker's own primary key. A
  // report-number fallback was considered here (the read side resolves by
  // report number too, #1673/#1931) but every current caller already sends
  // the row's own `#` (decision-card.tsx, status-select.tsx, the assistant
  // registry), so the fallback had no live caller to serve — only the risk
  // of one: if row #10 is ever deleted or renumbered, n:"10" would silently
  // start matching whichever OTHER row's Report cell happens to be [010],
  // writing status to the wrong role with no error. A write path should
  // refuse an ambiguous identifier, not guess it — so this stays a single,
  // unambiguous `#`-cell match.
  const target = String(n).trim();
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (i === headerLineIdx) continue; // never let n:"#" match the header's own "#" cell
    if (!lines[i].trim().startsWith("|")) continue;
    const parts = lines[i].split("|");
    if (parts.length < 8) continue;
    if (statusIdx >= parts.length - 1) continue; // guard malformed row
    if (/^:?-{2,}:?$/.test(parts[1]?.trim() ?? "")) continue; // never let n:"---" match the separator row
    if (parts[1].trim() !== target) continue;
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
