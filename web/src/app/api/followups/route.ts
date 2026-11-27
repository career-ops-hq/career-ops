import { coreProfileEnv } from "@/lib/core/profile-path.mjs";
import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { selectDueFollowups, pickNextUpcoming, selectUpcomingFollowups } from "@/lib/core/followup-view.mjs";

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
  if (!fs.existsSync(script)) {
    return Response.json({ available: false, metadata: null, entries: [], upcoming: [], nextUpcoming: null });
  }
  const { stdout, failure } = await new Promise<{ stdout: string; failure: string | null }>((resolve) => {
    // process.execPath + windowsHide: see api/doctor/route.ts — a stale inherited
    // console kills every child with 0xC0000142 on Windows; never inherit one.
    execFile(process.execPath, [script, "--json"], { cwd: resolveCodeRoot(process.cwd(), process.env), env: coreProfileEnv(careerOpsRoot()), timeout: 12_000, windowsHide: true }, (err, out, errOut) => {
      const stdout = out || "";
      resolve({ stdout, failure: err ? cadenceFailure(err, stdout, errOut || "") : null });
    });
  });
  // A script that ran and failed is a server fault with a reason, not a
  // missing script: the page shows the reason instead of "check the scripts".
  if (failure) return Response.json({ error: failure }, { status: 500 });
  try {
    const start = stdout.indexOf("{");
    const j = JSON.parse(stdout.slice(start));
    const entries = Array.isArray(j.entries) ? j.entries : [];
    const upcoming = selectUpcomingFollowups(entries, full ? undefined : 8);
    if (full) {
      return Response.json({
        available: true,
        metadata: j.metadata ?? null,
        entries,
        upcoming,
        cadenceConfig: j.cadenceConfig ?? null,
        followupsEnabled: j.followupsEnabled !== false,
      });
    }
    // Due now (urgency 'urgent'/'overdue'). Waiting and cold are not due and
    // must not be listed as if they were (#86). They go out as `upcoming`
    // so the home card and /followups can show them in their own section.
    // `nextUpcoming` stays the single nearest one, and only when nothing is
    // due, for callers that still read that field.
    const due = selectDueFollowups(entries, 8);
    const nextUpcoming = due.length ? null : pickNextUpcoming(entries);
    return Response.json({ available: true, metadata: j.metadata ?? null, entries: due, upcoming, nextUpcoming, followupsEnabled: j.followupsEnabled !== false });
  } catch {
    return Response.json({ error: "followup-cadence.mjs printed no JSON" }, { status: 500 });
  }
}

// Why the cadence run failed: its own JSON `error` (it prints one and exits 1),
// else how it ended plus the line from stderr that names the fault.
function cadenceFailure(err: ExecFileException, stdout: string, stderr: string): string {
  if (err.killed) return "followup-cadence.mjs timed out after 12s";
  try {
    const j = JSON.parse(stdout.slice(stdout.indexOf("{")));
    if (typeof j.error === "string" && j.error) return j.error;
  } catch {}
  const how = typeof err.code === "string" ? err.code : err.signal ? `killed by ${err.signal}` : `exit code ${err.code}`;
  // Node ends a crash with its version banner, which says nothing about it.
  const lines = stderr.split("\n").filter((l) => l.trim() && !/^Node\.js v\d/.test(l));
  const said = (lines.find((l) => /^\w*Error\b/.test(l)) ?? lines.pop())?.trim();
  return said ? `followup-cadence.mjs ${how}: ${said.slice(0, 300)}` : `followup-cadence.mjs ${how}`;
}
