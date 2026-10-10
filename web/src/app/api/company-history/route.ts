import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One company's evidence card from the core's company-history.mjs, which joins
// the tracker, follow-ups, scan history and status log. Read-only by contract —
// the script's header says it never writes a file.
//
// `--company` takes a NAME, and the name comes from a query string, so it is
// length-capped and newline-stripped before it becomes an argv. execFile takes
// an argument array and never a shell string, so there is no interpolation to
// escape; the cap is about refusing an absurd argv rather than about quoting.
const MAX_COMPANY = 120;

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("company") ?? "").trim();
  const company = raw.replace(/[\r\n\0]/g, "").slice(0, MAX_COMPANY);
  if (!company) return Response.json({ available: false, reason: "no-company", card: null });

  const script = rootScript("company-history");
  if (!fs.existsSync(script)) return Response.json({ available: false, reason: "no-script", card: null });

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [script, "--company", company],
      { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 8 << 20 },
      // stdout regardless of exit status: the script reports a missing source
      // inside its payload rather than by failing, and that payload is what the
      // card needs in order to say "not checked" instead of "nothing found".
      (_err, out) => resolve(out || ""),
    );
  });

  try {
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON");
    return Response.json({ available: true, reason: null, card: JSON.parse(stdout.slice(start)) });
  } catch {
    return Response.json({ available: false, reason: "unparseable", card: null });
  }
}
