import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The weighted skill-gap map from the core's upskill.mjs: which skills keep
// costing you roles, weighted so a 2.1/5 report counts for more than a 4.5/5 one.
//
// No flags. upskill.mjs prints JSON by default and rejects a --json flag, the
// same as stats.mjs and company-history.mjs — three of the analysis scripts
// share that convention while the follow-up routes pass the flag, so the shape
// is worth checking per script rather than copying.
//
// Never writes. upskill.mjs's own header is explicit that it never adds a claim
// to cv.md, and this route only reads its verdict.
export async function GET() {
  const script = rootScript("upskill");
  if (!fs.existsSync(script)) return Response.json({ available: false, reason: "no-script", data: null });

  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script], { cwd: careerOpsRoot(), timeout: 30_000, maxBuffer: 8 << 20 }, (_err, out) =>
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
