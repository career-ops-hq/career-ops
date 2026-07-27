import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DEMAND loop: surface follow-ups due, via the core's own
// followup-cadence.mjs --json (the SAME calculator the CLI uses) — we never
// reimplement the cadence logic, we read its verdict (mirrors /api/doctor).
export async function GET() {
  const script = rootScript("followup-cadence");
  if (!fs.existsSync(script)) return Response.json({ available: false, metadata: null, entries: [] });
  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script, "--json"], { cwd: careerOpsRoot(), timeout: 12_000 }, (_e, out) => resolve(out || ""));
  });
  try {
    const start = stdout.indexOf("{");
    const j = JSON.parse(stdout.slice(start));
    const entries = Array.isArray(j.entries) ? j.entries : [];
    // Overdue first; cap for the home (full list lives in the tracker).
    const overdue = entries.filter((e: { status?: string }) => /overdue|urgent/i.test(String(e.status))).slice(0, 8);
    const top = (overdue.length ? overdue : entries).slice(0, 6);
    return Response.json({ available: true, metadata: j.metadata ?? null, entries: top });
  } catch {
    return Response.json({ available: false, metadata: null, entries: [] });
  }
}
