import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lifetime pipeline stats, read from the core's own stats.mjs — the SAME
// calculator the CLI and the Go dashboard funnel agree on. We never recompute a
// rate here: computeFunnel()'s docstring in stats.mjs is the canonical funnel
// definition ("Hired counts into every stage through everOffer"), and a second
// implementation in TypeScript is how the web's numbers start disagreeing with
// the CLI's. Mirrors /api/followups and /api/doctor.
//
// stats.mjs prints JSON by DEFAULT and rejects a --json flag outright, so this
// passes no flags at all. Worth stating, because every sibling route here spawns
// the script with that flag and copying the shape silently fails.
//
// (The flag is named without quotes on purpose: tests/web-core-argv-contract
// greps this file for quoted --flag literals and requires each to appear in the
// argv it probes, so quoting it here would register a flag this route must
// never pass.)
export async function GET() {
  const script = rootScript("stats");
  if (!fs.existsSync(script)) return Response.json({ available: false, stats: null });

  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script], { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 8 << 20 }, (err, out) =>
      resolve(err ? "" : out || ""),
    );
  });

  try {
    // dotenv and friends can print a banner before the payload, so the JSON
    // starts at the first brace rather than at byte 0 (the same slice
    // /api/followups uses).
    const start = stdout.indexOf("{");
    if (start < 0) return Response.json({ available: false, stats: null });
    return Response.json({ available: true, stats: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, stats: null });
  }
}
