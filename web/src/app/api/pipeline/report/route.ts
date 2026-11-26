import { findApplication, requestReportReader } from "@/lib/career-ops";
import { applicationKey } from "@/lib/pipeline-status.mjs";

export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const app = findApplication(id);
  const headers = { "Cache-Control": "no-store" };
  if (!app) {
    return Response.json({ error: "Application not found" }, { status: 404, headers });
  }
  const report = requestReportReader()(app);
  return Response.json({ key: applicationKey(app), markdown: report?.content ?? null }, { headers });
}
