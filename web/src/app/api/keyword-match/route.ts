import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript, findReportFile } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ATS keyword coverage for one report, from the core's keyword-match.mjs.
//
// The report is resolved through findReportFile(), never from the query string:
// it parses the id as an integer and containment-checks the result against the
// data root, so `?report=../../etc/passwd` cannot become an argv. The only value
// this route passes to the script is a path the core itself vouched for.
//
// Diagnostic only, like the script — it reads a CV and a report and reports
// coverage. It never edits either, which is the project rule keyword-match.mjs
// states in its own header: "Keywords get reformulated, never fabricated".
export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("report") ?? "").trim();
  if (!id) return Response.json({ available: false, reason: "no-report", result: null });

  const file = findReportFile(id);
  if (!file) return Response.json({ available: false, reason: "no-report", result: null });

  const script = rootScript("keyword-match");
  if (!fs.existsSync(script)) return Response.json({ available: false, reason: "no-script", result: null });

  const { stdout, failed } = await new Promise<{ stdout: string; failed: boolean }>((resolve) => {
    execFile(
      "node",
      [script, file, "--json"],
      { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 4 << 20 },
      (err, out) => resolve({ stdout: out || "", failed: Boolean(err) }),
    );
  });

  try {
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON");
    return Response.json({ available: true, reason: null, result: JSON.parse(stdout.slice(start)) });
  } catch {
    // The common miss is a report with no `## Keywords extracted` block — older
    // reports and any written before that block existed. The script says so on
    // stdout and exits nonzero, and it is a fact about the REPORT rather than a
    // failure, so it gets its own reason instead of a generic error.
    const noKeywords = /keywords extracted/i.test(stdout);
    return Response.json({
      available: false,
      reason: noKeywords ? "no-keywords" : failed ? "failed" : "unparseable",
      result: null,
    });
  }
}
