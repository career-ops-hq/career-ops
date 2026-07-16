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
  // Find the Status and Report column indices from the header row (robust to
  // 8- vs 9-col and an optional Via column that shifts everything right).
  // Also remember the header line's index so the row-scan below can never
  // target it (a request with n: "#" must not match the header's own "#"
  // cell text and corrupt the table's structure). The separator row (e.g.
  // "|---|---|...|") is excluded generically in that scan instead, since it
  // normally follows immediately after the header — this loop breaks at the
  // header before ever reaching it.
  let statusIdx = 6;
  let reportIdx = -1;
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|").map((c) => c.trim().toLowerCase());
    const sIdx = cells.findIndex((c) => c === "status");
    if (sIdx > 0) {
      statusIdx = sIdx;
      reportIdx = cells.findIndex((c) => c === "report");
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

  // Resolve the row by its `#` cell first (the historical primary key), then
  // fall back to the report number parsed from its Report cell. The tracker `#`
  // and the report's own leading number can drift apart (a re-sequenced `#`
  // column), and the read side already resolves links/lookups by report number
  // (#1673, #1931). Without this fallback the writeback silently 404s on any row
  // whose `#` no longer equals its report number, so the client-side status
  // dropdown reverts and the row can never be updated from the web UI.
  const target = String(n).trim();
  const targetNum = Number.parseInt(target, 10);
  const reportNumOf = (parts: string[]): number => {
    if (reportIdx < 0 || reportIdx >= parts.length) return NaN;
    const m = parts[reportIdx].match(/\[(\d+)\]/); // "[010](../reports/010-…)" → 10
    return m ? Number.parseInt(m[1], 10) : NaN;
  };

  let primaryHit = -1; // exact `#`-cell match
  let reportHit = -1; // report-number match (fallback)
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === headerLineIdx) continue; // never let n:"#" match the header's own "#" cell
    if (!lines[i].trim().startsWith("|")) continue;
    const parts = lines[i].split("|");
    if (parts.length < 8) continue;
    if (statusIdx >= parts.length - 1) continue; // guard malformed row
    if (/^:?-{2,}:?$/.test(parts[1]?.trim() ?? "")) continue; // never let n:"---" match the separator row
    rows[i] = parts;
    if (parts[1].trim() === target) {
      primaryHit = i;
      break; // exact `#`-cell match always wins — no need to keep scanning for a report-number fallback
    }
    if (reportHit < 0 && !Number.isNaN(targetNum) && reportNumOf(parts) === targetNum) reportHit = i;
  }

  const hit = primaryHit >= 0 ? primaryHit : reportHit;
  let changed = false;
  if (hit >= 0) {
    const parts = rows[hit];
    parts[statusIdx] = ` ${canon} `;
    lines[hit] = parts.join("|");
    changed = true;
  }
  if (!changed) return NextResponse.json({ error: "row not found" }, { status: 404 });

  try {
    atomicWrite(file, lines.join("\n"));
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: canon });
}
