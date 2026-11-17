import path from "node:path";
import { careerOpsRoot, findApplication, findReportFile, readReport } from "@/lib/career-ops";
import { parseReport } from "@/lib/format";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { applyPostingUrl } from "@/lib/posting-url.mjs";
import { runCoreCli } from "@/lib/core-cli";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    // Bound streamed input too: Content-Length is not a trustworthy limit.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Missing request" }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 250_000) { await reader.cancel(); return Response.json({ error: "Description too large" }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) return Response.json({ error: "Invalid application" }, { status: 400 });
    const application = findApplication(body.id);
    if (!application) return Response.json({ error: "Application not found" }, { status: 404 });
    const report = readReport(body.id);
    const reportPath = findReportFile(body.id);
    const meta = parseReport(report?.content || "");
    const app = {
      id: application.n, company: application.company, title: application.role,
      reportNum: reportNumberFor(body.id, application, report?.file ?? null),
      // report.file is a display basename; preserve the resolver's directory.
      reportFile: reportPath ? path.relative(careerOpsRoot(), reportPath) : null,
      url: applyPostingUrl(meta.fields.find(f => f.label === "URL")?.value, application.url, application.applyLink),
    };
    const result = await runCoreCli("role-change-radar", [], {
      input: JSON.stringify({ app, input: { action: body.action, source: body.source, text: body.text, comparisonId: body.comparisonId } }),
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.timedOut || result.spawnFailed) return Response.json({ error: "Unable to check: core process unavailable or timed out. Previous results are preserved." }, { status: 503 });
    const state = JSON.parse(result.stdout);
    return Response.json(state, { status: result.code === 0 ? 200 : 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to check" }, { status: 400 });
  }
}
