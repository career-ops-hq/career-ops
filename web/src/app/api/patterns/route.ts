import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pattern analysis from the core's analyze-patterns.mjs.
//
// It refuses below a minimum sample and says so in its own payload:
//
//   { "error": "Not enough data: 4/5 applications sent…", "current": 4, "threshold": 5 }
//
// That is a RESULT, not a failure, and it is passed through rather than
// flattened into `available: false`. The threshold is the core's honesty about
// small samples — the same reasoning behind stats.mjs's `smallSample` flag — and
// a UI that hides it would show a user an empty panel where the core had a
// reason to give.
export async function GET() {
  const script = rootScript("analyze-patterns");
  if (!fs.existsSync(script)) return Response.json({ available: false, patterns: null });

  // stdout is kept EVEN ON A NONZERO EXIT, unlike the sibling routes. Measured:
  // analyze-patterns.mjs exits 1 when it is under its minimum sample, while
  // still printing the payload that explains why. Following /api/followups'
  // `err ? "" : out` here would throw that payload away and render the panel as
  // unavailable — the user would see an empty box instead of "4/5 applications
  // sent". A crash still yields no parseable JSON and falls through below.
  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script], { cwd: careerOpsRoot(), timeout: 30_000, maxBuffer: 8 << 20 }, (_err, out) =>
      resolve(out || ""),
    );
  });

  try {
    const start = stdout.indexOf("{");
    if (start < 0) return Response.json({ available: false, patterns: null });
    return Response.json({ available: true, patterns: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, patterns: null });
  }
}
