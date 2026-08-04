import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "@/lib/core/safe-write";
import { CHANNELS, isRealISODate, localISODate } from "@/lib/followups";
import { followupsLogPath, withLogLock } from "@/lib/followups-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Append-only follow-up log → data/follow-ups.md (NEVER clobber; the cadence
// calculator reads this to advance the schedule). Writes the canonical TABLE row
// the core's followup-cadence.mjs parses:
//   | num | appNum | date | company | role | channel | contact | notes |
// (Earlier builds wrote bullet lines; those stay in place — the core parser now
// reads both formats — but every new log is a full-fidelity table row.)

/** Table cells must stay single-line and pipe-free. `max` optional — notes are
 *  deliberately uncapped (user decision), identity fields keep a sanity cap. */
function cell(v: unknown, max?: number): string {
  const s = String(v ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "/")
    .trim();
  return max ? s.slice(0, max) : s;
}

const TABLE_HEADER = "| num | appNum | date | company | role | channel | contact | notes |\n|---|---|---|---|---|---|---|---|\n";

export async function POST(req: Request) {
  let body: {
    appNum?: string | number;
    num?: string | number; // legacy alias for appNum (old home-card payload)
    company?: string;
    role?: string;
    date?: string;
    channel?: string;
    contact?: string;
    notes?: string;
    note?: string; // legacy alias for notes
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const appNum = Number.parseInt(String(body.appNum ?? body.num ?? ""), 10);
  if (!Number.isInteger(appNum) || appNum < 0) {
    return Response.json({ error: "appNum (application #) required" }, { status: 400 });
  }
  const company = cell(body.company, 80);
  if (!company) return Response.json({ error: "company required" }, { status: 400 });

  // Default to the LOCAL day (local-first app — server clock is the user's
  // clock); validate as a REAL calendar date, not just the shape: one
  // impossible date (2026-13-45) in the log would crash the cadence engine.
  const date = (body.date ?? localISODate()).trim();
  if (!isRealISODate(date)) {
    return Response.json({ error: "date must be a real calendar date (YYYY-MM-DD)" }, { status: 400 });
  }
  const rawChannel = (body.channel ?? "Other").trim();
  const channel = CHANNELS.find((c) => c.toLowerCase() === rawChannel.toLowerCase());
  if (!channel) {
    return Response.json({ error: `channel must be one of: ${CHANNELS.join(", ")}` }, { status: 400 });
  }
  const role = cell(body.role, 80);
  const contact = cell(body.contact, 120);
  const notes = cell(body.notes ?? body.note ?? "");

  const file = followupsLogPath();
  try {
    return await withLogLock(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let existing = "";
      if (fs.existsSync(file)) existing = fs.readFileSync(file, "utf8");
      else fs.writeFileSync(file, "# Follow-ups\n\n", "utf8");

      // Auto-increment num = max existing TABLE num + 1 (legacy bullets carry none).
      let maxNum = 0;
      let hasHeader = false;
      for (const line of existing.split("\n")) {
        if (!line.startsWith("|")) continue;
        const first = line.split("|")[1]?.trim() ?? "";
        // Both header spellings exist in the wild: "num" (this writer) and
        // "#" (files created per modes/followup.md) — recognize either, or a
        // second header block gets appended into CLI-created files.
        if (/^(num|#)$/i.test(first)) hasHeader = true;
        const n = Number.parseInt(first, 10);
        if (Number.isInteger(n) && n > maxNum) maxNum = n;
      }
      const num = maxNum + 1;

      let out = "";
      // CLI-created files may lack a trailing newline — guard regardless of
      // whether we're also inserting the header, or the row glues to the last line.
      if (existing && !existing.endsWith("\n")) out += "\n";
      if (!hasHeader) out += TABLE_HEADER;
      out += `| ${num} | ${appNum} | ${date} | ${company} | ${role} | ${channel} | ${contact} | ${notes} |\n`;
      fs.appendFileSync(file, out, "utf8");
      return Response.json({ ok: true, num, appNum, date, channel });
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
}

// Remove ONE logged follow-up by its `num` (mistake correction — user-initiated
// from the history panel). Only the matching table row is dropped; every other
// byte of the file (header, other rows, legacy bullets) is preserved. Legacy
// bullets carry no num and cannot be deleted here.
export async function DELETE(req: Request) {
  let body: { num?: string | number };
  try {
    body = (await req.json()) as { num?: string | number };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const num = Number.parseInt(String(body.num ?? ""), 10);
  if (!Number.isInteger(num) || num <= 0) return Response.json({ error: "num required" }, { status: 400 });

  const file = followupsLogPath();
  if (!fs.existsSync(file)) return Response.json({ error: "no follow-up log" }, { status: 404 });
  try {
    return await withLogLock(() => {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const idx = lines.findIndex((line) => {
        if (!line.startsWith("|")) return false;
        const first = line.split("|")[1]?.trim() ?? "";
        return Number.parseInt(first, 10) === num && /^\d+$/.test(first);
      });
      if (idx === -1) return Response.json({ error: `follow-up #${num} not found` }, { status: 404 });
      lines.splice(idx, 1);
      atomicWrite(file, lines.join("\n"));
      return Response.json({ ok: true, num });
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
