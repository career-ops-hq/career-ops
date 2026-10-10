import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Companies still in Interview whose silence since the last round has passed a
// courtesy threshold, from the core's rejection-latency.mjs.
//
// SUGGESTION-ONLY, and the script says so in its own header: it "never writes".
// This route is read-only too — in particular it does not touch
// data/blacklist.md, which AGENTS.md describes as opt-in and never
// auto-populated. The script hands back a ready-to-paste blacklist row; pasting
// it stays the user's decision.
//
// No flags: rejection-latency.mjs prints JSON by default, like stats.mjs and
// upskill.mjs. The argv is registered in tests/web-core-argv-contract.test.mjs.
export async function GET() {
  const script = rootScript("rejection-latency");
  if (!fs.existsSync(script)) return Response.json({ available: false, reason: "no-script", data: null });

  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script], { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 8 << 20 }, (_err, out) =>
      resolve(out || ""),
    );
  });

  try {
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON");
    return Response.json({ available: true, reason: null, data: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, reason: "unparseable", data: null });
  }
}
