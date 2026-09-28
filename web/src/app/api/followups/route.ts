import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { selectDueFollowups, pickNextUpcoming } from "@/lib/core/followup-view.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DEMAND loop: surface follow-ups due, via the core's own
// followup-cadence.mjs --json (the SAME calculator the CLI uses) — we never
// reimplement the cadence logic, we read its verdict (mirrors /api/doctor).
// Default: capped list for the home card. `?full=1`: the complete cadence
// (entries + metadata + cadenceConfig) for the /followups tracker page.
export async function GET(req: Request) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const script = rootScript("followup-cadence");
  if (!fs.existsSync(script)) return Response.json({ available: false, metadata: null, entries: [], nextUpcoming: null });
  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script, "--json"], { cwd: careerOpsRoot(), timeout: 12_000 }, (err, out) => resolve(err ? "" : out || ""));
  });
  try {
    const start = stdout.indexOf("{");
    const j = JSON.parse(stdout.slice(start));
    const entries = Array.isArray(j.entries) ? j.entries : [];
    if (full) {
      return Response.json({
        available: true,
        metadata: j.metadata ?? null,
        entries,
        cadenceConfig: j.cadenceConfig ?? null,
      });
    }
    // Due now (urgency 'urgent'/'overdue') — 'waiting'/'cold' are NOT due,
    // and must never be shown as if they were (#86). When nothing is due,
    // surface the single nearest upcoming follow-up instead of falling back
    // to an unfiltered list.
    const due = selectDueFollowups(entries, 8);
    const nextUpcoming = due.length ? null : pickNextUpcoming(entries);
    return Response.json({ available: true, metadata: j.metadata ?? null, entries: due, nextUpcoming });
  } catch {
    return Response.json({ available: false, metadata: null, entries: [], nextUpcoming: null });
  }
}
